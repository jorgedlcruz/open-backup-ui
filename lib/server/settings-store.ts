import fs from 'fs';
import path from 'path';
import { encrypt, decrypt } from './encryption';

const DATA_DIR = path.join(process.cwd(), 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

export interface AiSettings {
    provider: string; // 'openai', 'gemini', 'anthropic', 'ollama'
    modelName?: string;
    apiKey?: string; // Decrypted when retrieved internally, masked when retrieved for UI
    encryptedApiKey?: string;
    baseUrl?: string; // useful for Ollama
}

export interface AppSettings {
    ai: AiSettings;
}

const defaultSettings: AppSettings = {
    ai: {
        provider: 'openai',
        modelName: 'gpt-4o-mini',
    }
};

export const settingsStore = {
    get(): AppSettings {
        if (!fs.existsSync(SETTINGS_FILE)) {
            return defaultSettings;
        }
        try {
            const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
            const stored = JSON.parse(data) as AppSettings;
            
            // Decrypt API key for internal use
            if (stored.ai?.encryptedApiKey) {
                try {
                    stored.ai.apiKey = decrypt(stored.ai.encryptedApiKey);
                } catch (e) {
                    console.error('Failed to decrypt AI API key', e);
                }
            }
            return stored;
        } catch (e) {
            console.error('Failed to read settings store:', e);
            return defaultSettings;
        }
    },

    getMasked(): AppSettings {
        const settings = this.get();
        if (settings.ai?.apiKey) {
            settings.ai.apiKey = 'sk-••••••••••••••••••••••••••••';
        }
        delete settings.ai.encryptedApiKey;
        return settings;
    },

    save(newSettings: Partial<AppSettings>) {
        const current = this.get();
        
        let encryptedApiKey = current.ai?.encryptedApiKey;
        
        // If a new API key is provided and it's not the masked string
        if (newSettings.ai?.apiKey && !newSettings.ai.apiKey.includes('••••')) {
            encryptedApiKey = encrypt(newSettings.ai.apiKey);
        }

        const merged: AppSettings = {
            ai: {
                ...current.ai,
                ...newSettings.ai,
                encryptedApiKey,
                apiKey: undefined // Don't store the raw key
            }
        };

        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));
    }
};
