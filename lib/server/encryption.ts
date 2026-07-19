import crypto from 'crypto';
import os from 'os';
import path from 'path';
import fs from 'fs';

export const LEGACY_DEFAULT_KEY = 'default-secure-key-32-chars-long!!';
const KEY_FILE_PATH = path.join(os.homedir(), '.open-backup-ui-key');

export function getEncryptionKey(): string {
    // 1. Prefer Environment Variable (Validation/Override)
    if (process.env.ENCRYPTION_KEY) {
        return process.env.ENCRYPTION_KEY;
    }

    // 2. Load from User Home Directory (Machine-specific persistent key)
    if (fs.existsSync(KEY_FILE_PATH)) {
        try {
            return fs.readFileSync(KEY_FILE_PATH, 'utf-8').trim();
        } catch (e) {
            console.error('Failed to read encryption key file:', e);
        }
    }

    // 3. Generate New Unique Key and Save It
    try {
        const newKey = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(KEY_FILE_PATH, newKey, { mode: 0o600 }); // Read/write only by owner
        console.log(`[ConfigStore] Generated new unique encryption key at ${KEY_FILE_PATH}`);
        return newKey;
    } catch (e) {
        console.error('Failed to write encryption key file, falling back to legacy default:', e);
        return LEGACY_DEFAULT_KEY;
    }
}

export const ENCRYPTION_KEY = getEncryptionKey();
const IV_LENGTH = 16;
const SALT = 'salt'; // Fixed salt for determinism

export function encrypt(text: string, keyString: string = ENCRYPTION_KEY): string {
    const key = crypto.scryptSync(keyString, SALT, 32);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decrypt(text: string, keyString: string = ENCRYPTION_KEY): string {
    const key = crypto.scryptSync(keyString, SALT, 32);
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift()!, 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}
