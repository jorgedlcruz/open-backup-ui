// Open Backup UI v1.3.0
import fs from 'fs';
import { randomUUID } from 'node:crypto';
import { withFileLease } from './file-lease';
import { replaceFile } from './atomic-file';
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
    retiredVbr?: boolean;
}


export const SINGLE_VBR_CONFLICT = 'Only one Veeam Backup & Replication server can be configured.';
export const CATALOG_BUSY = 'This source changed during authentication. Refresh and reconnect.';
function environmentVbr(): VBRSource | null {
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

type Address = Pick<VBRSource, 'host' | 'port' | 'protocol'>;
export function vbrOrigin(source: Address) {
    return new URL(`${source.protocol}://${source.host}:${source.port}`).origin;
}
function activeStoredVbr(stored: StoredSource[], env: VBRSource | null) {
    return stored.find(source => source.platform === 'vbr' && !source.retiredVbr &&
        (!env || vbrOrigin(source) === vbrOrigin(env)));
}
function publicSource(source: StoredSource): VBRSource {
    const { encryptedPassword, ...rest } = source;
    delete rest.retiredVbr;
    return { ...rest, hasCredentials: !!encryptedPassword };
}
function storedSources(): StoredSource[] {
    return fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : [];
}
// Each writer rechecks the slot under the same lock, including legacy sign-in.
async function updateCatalog<T>(modify: (stored: StoredSource[]) => Promise<T> | T) {
    const write = () => withFileLease(CONFIG_FILE + '.lock', 30_000, async () => {
        const stored = storedSources();
        const value = await modify(stored);
        const temp = CONFIG_FILE + '.' + randomUUID() + '.tmp';
        try {
            await fs.promises.writeFile(temp, JSON.stringify(stored, null, 2), { flag: 'wx', mode: 0o600 });
            await replaceFile(temp, CONFIG_FILE);
        } finally { await fs.promises.unlink(temp).catch(() => {}); }
        return { value };
    });
    // A password grant can keep the slot reserved for its 15-second request timeout.
    const deadline = Date.now() + 17_000;
    for (let delay = 25; Date.now() < deadline; delay = Math.min(delay * 2, 400)) {
        const result = await write();
        if (result) return result.value;
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw new Error(CATALOG_BUSY);
}

// --- Migration Logic ---

function migrateLegacyPasswords() {
    if (!fs.existsSync(CONFIG_FILE)) return;

    // If the current key IS the legacy key, no migration needed (or possible)
    if (ENCRYPTION_KEY === LEGACY_DEFAULT_KEY) return;

    try {
        const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const stored: StoredSource[] = JSON.parse(data);
        const replacements = new Map<string, string>();
        for (const source of stored) {
            if (!source.encryptedPassword) continue;

            // Try decrypting with current (new) key first
            try {
                decrypt(source.encryptedPassword, ENCRYPTION_KEY);
            } catch {
                // Decryption failed, likely using legacy key. Try migrating.
                try {
                    const plain = decrypt(source.encryptedPassword, LEGACY_DEFAULT_KEY);
                    replacements.set(source.encryptedPassword, encrypt(plain, ENCRYPTION_KEY));
                } catch (legacyErr) {
                    console.error(`[ConfigStore] Failed to migrate password for ${source.host}:`, legacyErr);
                }
            }
        }

        // Read again under the catalog lock so startup in another process
        // cannot overwrite concurrent registrations or credential changes.
        if (replacements.size) void updateCatalog(current => {
            for (const source of current) {
                const replacement = source.encryptedPassword && replacements.get(source.encryptedPassword);
                if (replacement) source.encryptedPassword = replacement;
            }
        }).catch(error => console.error('[ConfigStore] Password migration failed:', error));
    } catch (e) {
        console.error('[ConfigStore] Migration check failed:', e);
    }
}

// Initialize migration check
migrateLegacyPasswords();

// --- Export ---

export const configStore = {
    getAll(strict = false): VBRSource[] {
        if (!fs.existsSync(CONFIG_FILE)) {
            return [];
        }
        try {
            const stored = storedSources();
            const active = activeStoredVbr(stored, environmentVbr());
            return stored.filter(s => s.platform !== 'vbr' || s === active).map(publicSource);
        } catch (e) {
            console.error('Failed to read config store:', e);
            if (strict) throw new Error('Data-source configuration is unreadable.');
            return [];
        }
    },

    getVbr(): VBRSource | null {
        const env = environmentVbr();
        const saved = activeStoredVbr(storedSources(), env);
        return saved ? publicSource(saved) : env;
    },

    getById(id: string, includePassword = true): VBRSource | null {
        // Handle Environment Variable Sources
        if (id === 'env-vbr') {
            return environmentVbr();
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
        if (!found || (found.platform === 'vbr' && found !== activeStoredVbr(stored, environmentVbr()))) return null;
        if (!includePassword) return publicSource(found);

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

    async save<T = void>(source: VBRSource, validate?: () => Promise<T>) {
        return updateCatalog(async stored => {
            if (source.platform === 'vbr') {
                const env = environmentVbr(), active = activeStoredVbr(stored, env);
                if ((env && (!active || vbrOrigin(source) !== vbrOrigin(env))) ||
                    (active && source.id !== active.id)) throw new Error(SINGLE_VBR_CONFLICT);
                // An explicit registration can reuse a retired ID only when the slot is free.
            }
            const result = await validate?.();
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

            return result;
        });
    },

    async delete(id: string) {
        await updateCatalog(stored => {
            const index = stored.findIndex(source => source.id === id);
            if (index < 0) return;
            if (stored[index].platform === 'vbr') {
                const active = activeStoredVbr(stored, environmentVbr());
                if (stored[index] !== active) return;
                // Removing the active source must leave the VBR slot empty. Keep
                // encrypted historical records on disk without promoting one.
                for (const row of stored) if (row.platform === 'vbr' && row !== active) row.retiredVbr = true;
            }
            stored.splice(index, 1);
        });
    }
};
