// Helper for VB365 API routes to get token and base URL (same pattern as VBR)
import { cookies } from 'next/headers';
import { getChunkedCookie } from '@/lib/utils/cookie-manager';
import { tokenManager } from './token-manager';
import { configStore } from './config-store';

async function loginWithEnvVars(baseUrl: string): Promise<string | null> {
    const username = process.env.VBM_USERNAME;
    const password = process.env.VBM_PASSWORD;

    if (!username || !password) return null;

    try {
        console.log('[VB365 Helper] Attempting login via Env Vars...');
        const body = new URLSearchParams({
            grant_type: 'password',
            username,
            password
        });

        const response = await fetch(`${baseUrl}/v7/Token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: body
        });

        if (!response.ok) {
            console.error('[VB365 Helper] Env var login failed:', response.status);
            return null;
        }

        const data = await response.json();
        return data.access_token;
    } catch (error) {
        console.error('[VB365 Helper] Env var login error:', error);
        return null;
    }
}

export async function getVB365Config(): Promise<{ baseUrl: string; token: string } | null> {
    const cookieStore = await cookies();

    // 1. Try to find a stored VB365 source in the server-side config store (GLOBAL CONFIG)
    const allSources = configStore.getAll();
    const vb365Source = allSources.find(s => s.platform === 'vb365');

    if (vb365Source) {
        const token = await tokenManager.getToken(vb365Source.id);
        if (token) {
            return {
                baseUrl: `${vb365Source.protocol}://${vb365Source.host}:${vb365Source.port}`,
                token
            };
        }
    }

    // 2. Fallback: Legacy cookie token (Client Cookie)
    const cookieToken = getChunkedCookie(cookieStore, 'veeam_vb365_token');
    const cookieUrl = cookieStore.get('veeam_vb365_token_url')?.value;

    if (cookieToken && cookieUrl) {
        return { baseUrl: cookieUrl, token: cookieToken };
    }

    // 3. Fallback: Env Vars (Global Config)
    const envUrl = process.env.VBM_API_URL;
    if (envUrl && process.env.VBM_USERNAME && process.env.VBM_PASSWORD) {
        const token = await loginWithEnvVars(envUrl);
        if (token) {
            return { baseUrl: envUrl, token };
        }
    }

    return null;
}

export async function refreshVB365Token(): Promise<string | null> {
    // 1. Refresh via Token Manager (Global Config)
    const allSources = configStore.getAll();
    const vb365Source = allSources.find(s => s.platform === 'vb365');

    if (vb365Source) {
        return tokenManager.refreshToken(vb365Source.id);
    }

    // 2. Refresh via Env Vars
    const baseUrl = process.env.VBM_API_URL;
    if (baseUrl && process.env.VBM_USERNAME && process.env.VBM_PASSWORD) {
        return loginWithEnvVars(baseUrl);
    }

    // Can't refresh legacy cookie without credentials
    return null;
}
