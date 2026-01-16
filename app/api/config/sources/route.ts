import { NextResponse } from 'next/server';
import { configStore, VBRSource } from '@/lib/server/config-store';

export const dynamic = 'force-dynamic';

export async function GET() {
    const stored = configStore.getAll();
    const sources: VBRSource[] = [...stored];

    // Check VBR Env Var
    const vbrUrl = process.env.VEEAM_API_URL || process.env.VBR_API_URL;
    if (vbrUrl && !sources.some(s => s.platform === 'vbr')) {
        try {
            const url = new URL(vbrUrl);
            sources.push({
                id: 'env-vbr',
                platform: 'vbr',
                host: url.hostname,
                port: parseInt(url.port) || 9419,
                protocol: url.protocol.replace(':', ''),
                username: process.env.VEEAM_USERNAME || 'Administrator',
            } as VBRSource);
        } catch (e) {
            console.error('Invalid VBR Env URL:', e);
        }
    }

    // Check VB365 (VBM) Env Var
    const vbmUrl = process.env.VBM_API_URL;
    if (vbmUrl && !sources.some(s => s.platform === 'vb365')) {
        try {
            const url = new URL(vbmUrl);
            sources.push({
                id: 'env-vb365',
                platform: 'vb365',
                host: url.hostname,
                port: parseInt(url.port) || 4443,
                protocol: url.protocol.replace(':', ''),
                username: 'Environment Variable',
            } as VBRSource);
        } catch (e) {
            console.error('Invalid VBM Env URL:', e);
        }
    }

    // Check Veeam ONE Env Var
    const oneUrl = process.env.VEEAM_ONE_API_URL;
    if (oneUrl && !sources.some(s => s.platform === 'one')) {
        try {
            const url = new URL(oneUrl);
            sources.push({
                id: 'env-one',
                platform: 'one',
                host: url.hostname,
                port: parseInt(url.port) || 1239,
                protocol: url.protocol.replace(':', ''),
                username: process.env.VEEAM_ONE_USERNAME || 'Administrator',
                hasCredentials: !!process.env.VEEAM_ONE_PASSWORD
            } as VBRSource);
        } catch (e) {
            console.error('Invalid Veeam ONE Env URL:', e);
        }
    }

    // Map to client format
    // Map to client format
    const clientSources = sources.map(s => {
        const url = `${s.protocol}://${s.host}:${s.port}`;
        let name = url;

        // Use custom logic for friendlier names if just one
        if (s.id.startsWith('env-')) {
            name = s.platform === 'vbr' ? 'Veeam Backup & Replication (Env)' :
                s.platform === 'vb365' ? 'Veeam Backup for Microsoft 365 (Env)' :
                    s.platform === 'one' ? 'Veeam ONE (Env)' : name;
        }

        return {
            id: s.id,
            type: s.platform,
            name: name,
            url: url,
            isAuthenticated: false, // Client will verify auth status via session API
            hasCredentials: s.hasCredentials || (s.id.startsWith('env-') && (!!process.env[`VEEAM_PASSWORD`] || !!process.env[`VBR_PASSWORD`] || !!process.env[`VBM_PASSWORD`]))
        };
    });

    return NextResponse.json(clientSources);
}
