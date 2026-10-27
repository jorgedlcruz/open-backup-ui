import fs from 'fs';
import path from 'path';
import { encrypt, decrypt, ENCRYPTION_KEY, LEGACY_DEFAULT_KEY } from './encryption';

const DATA_DIR = path.join(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'sources.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// --- Data Types ---

export interface VBRSource {
    id: string;
    host: string;
    port: number;
    username: string;
    password?: string; // Only used internally, never returned in list
    protocol: string;
    platform: 'vbr' | 'vb365' | 'vro' | 'one' | 'kasten';
    name?: string;
    hasCredentials?: boolean;
}

interface StoredSource extends Omit<VBRSource, 'password'> {
    encryptedPassword?: string;
}

// --- Migration Logic ---

function migrateLegacyPasswords() {
    if (!fs.existsSync(CONFIG_FILE)) return;

    // If the current key IS the legacy key, no migration needed (or possible)
    if (ENCRYPTION_KEY === LEGACY_DEFAULT_KEY) return;

    try {
        const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const stored: StoredSource[] = JSON.parse(data);
        let modified = false;

        const updated = stored.map(source => {
            if (!source.encryptedPassword) return source;

            // Try decrypting with current (new) key first
            try {
                decrypt(source.encryptedPassword, ENCRYPTION_KEY);
                return source; // Already encrypted with new key
            } catch {
                // Decryption failed, likely using legacy key. Try migrating.
                try {
                    const plain = decrypt(source.encryptedPassword, LEGACY_DEFAULT_KEY);
                    // Re-encrypt with new key
                    const reEncrypted = encrypt(plain, ENCRYPTION_KEY);
                    console.log(`[ConfigStore] Migrated password for source ${source.host}`);
                    modified = true;
                    return { ...source, encryptedPassword: reEncrypted };
                } catch (legacyErr) {
                    console.error(`[ConfigStore] Failed to migrate password for ${source.host}:`, legacyErr);
                    return source; // Leave as is if both fail
                }
            }
        });

        if (modified) {
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2));
            console.log('[ConfigStore] Migration complete: All passwords re-encrypted with machine key.');
        }
    } catch (e) {
        console.error('[ConfigStore] Migration check failed:', e);
    }
}

// Initialize migration check
migrateLegacyPasswords();

// --- Export ---

export const configStore = {
    getAll(): VBRSource[] {
        if (!fs.existsSync(CONFIG_FILE)) {
            return [];
        }
        try {
            const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
            const stored: StoredSource[] = JSON.parse(data);
            return stored.map(s => {
                // Return without password for safety but indicate if present
                const { encryptedPassword, ...rest } = s;
                return {
                    ...rest,
                    hasCredentials: !!encryptedPassword
                } as VBRSource;
            });
        } catch (e) {
            console.error('Failed to read config store:', e);
            return [];
        }
    },

    getById(id: string): VBRSource | null {
        // Handle Environment Variable Sources
        if (id === 'env-vbr') {
            const urlStr = process.env.VEEAM_API_URL || process.env.VBR_API_URL;
            if (!urlStr) return null;
            try {
                const url = new URL(urlStr);
                return {
                    id: 'env-vbr',
                    host: url.hostname,
                    port: parseInt(url.port) || 9419,
                    protocol: url.protocol.replace(':', ''),
                    username: process.env.VEEAM_USERNAME || process.env.VBR_USERNAME || 'Administrator',
                    password: process.env.VEEAM_PASSWORD || process.env.VBR_PASSWORD,
                    platform: 'vbr',
                    hasCredentials: !!(process.env.VEEAM_PASSWORD || process.env.VBR_PASSWORD)
                };
            } catch { return null; }
        }
        if (id === 'env-vb365') {
            const urlStr = process.env.VBM_API_URL;
            if (!urlStr) return null;
            try {
                const url = new URL(urlStr);
                return {
                    id: 'env-vb365',
                    host: url.hostname,
                    port: parseInt(url.port) || 4443,
                    protocol: url.protocol.replace(':', ''),
                    username: process.env.VBM_USERNAME || '',
                    password: process.env.VBM_PASSWORD,
                    platform: 'vb365',
                    hasCredentials: !!process.env.VBM_PASSWORD
                };
            } catch { return null; }
        }

        if (id === 'env-one' || id === 'env-vro') {
            const prefix = id === 'env-one' ? 'VEEAM_ONE' : 'VRO';
            const value = process.env[`${prefix}_API_URL`];
            if (!value) return null;
            try {
                const url = new URL(value);
                return { id, host:url.hostname, port:Number(url.port || (url.protocol === 'https:' ? 443 : 80)), protocol:url.protocol.slice(0,-1), platform:id === 'env-one' ? 'one':'vro', username:process.env[`${prefix}_USERNAME`] || '', password:process.env[`${prefix}_PASSWORD`], hasCredentials:!!process.env[`${prefix}_PASSWORD`] };
            } catch { return null; }
        }
        if (!fs.existsSync(CONFIG_FILE)) return null;
        const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const stored: StoredSource[] = JSON.parse(data);
        const found = stored.find(s => s.id === id);
        if (!found) return null;

        const { encryptedPassword, ...rest } = found;
        let decryptedPassword;

        if (encryptedPassword) {
            try {
                decryptedPassword = decrypt(encryptedPassword);
            } catch (e) {
                console.error(`Failed to decrypt password for ${id}, attempting legacy fallback`, e);
                // Fallback: Check if it's still legacy (in case migration missed run)
                try {
                    decryptedPassword = decrypt(encryptedPassword, LEGACY_DEFAULT_KEY);
                } catch {
                    // Both failed
                    console.error(`Critical: Could not decrypt password for ${id}`);
                }
            }
        }

        return {
            ...rest,
            password: decryptedPassword
        } as VBRSource;
    },

    save(source: VBRSource) {
        let stored: StoredSource[] = [];
        if (fs.existsSync(CONFIG_FILE)) {
            stored = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        }

        const encryptedPassword = source.password ? encrypt(source.password) : undefined;

        // Remove existing if update
        const index = stored.findIndex(s => s.id === source.id);
        const newEntry: StoredSource = {
            id: source.id,
            host: source.host,
            port: source.port,
            username: source.username,
            protocol: source.protocol || 'https',
            platform: source.platform,
            ...(source.name ? {name:source.name} : {}),
            encryptedPassword
        };

        if (index >= 0) {
            stored[index] = newEntry;
        } else {
            stored.push(newEntry);
        }

        fs.writeFileSync(CONFIG_FILE, JSON.stringify(stored, null, 2));
    },

    delete(id: string) {
        if (!fs.existsSync(CONFIG_FILE)) return;
        let stored: StoredSource[] = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        stored = stored.filter(s => s.id !== id);
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(stored, null, 2));
    }
};
