import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { tokenManager } from '@/lib/server/token-manager';
import { configStore } from '@/lib/server/config-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const cookieStore = await cookies();
        let sourceId = cookieStore.get('veeam_source_id')?.value;
        const cookieUrl = cookieStore.get('veeam_vbr_token_url')?.value;
        let baseUrl = cookieUrl || process.env.VEEAM_API_URL || process.env.VBR_API_URL || '';

        // Check global config if no session context
        if (!sourceId) {
            const storedSources = configStore.getAll();
            const vbrSource = storedSources.find(s => s.platform === 'vbr');
            if (vbrSource) {
                sourceId = vbrSource.id;
                baseUrl = `${vbrSource.protocol}://${vbrSource.host}:${vbrSource.port}`;
            }
        }

        if (!baseUrl && !sourceId) {
            return NextResponse.json(
                { error: 'Server configuration error: No configured Data Source' },
                { status: 500 }
            );
        }

        let token: string | null = null;
        if (sourceId) {
            token = await tokenManager.getToken(sourceId);
        }

        if (!token) {
            const authHeader = request.headers.get('authorization');
            if (authHeader?.startsWith('Bearer ')) {
                token = authHeader.substring(7);
            }
        }

        if (!token) {
            return NextResponse.json({ error: 'Authorization required' }, { status: 401 });
        }

        let response = await fetch(`${baseUrl}/api/v1/license`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-api-version': '1.3-rev1',
                'Accept': 'application/json'
            },
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            agent: new (require('https').Agent)({ rejectUnauthorized: false })
        } as RequestInit);

        // Auto-refresh mechanism
        if (response.status === 401 && sourceId) {
            console.log('[License] 401 received, refreshing token...');
            const newToken = await tokenManager.refreshToken(sourceId);
            if (newToken) {
                response = await fetch(`${baseUrl}/api/v1/license`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${newToken}`,
                        'x-api-version': '1.3-rev1',
                        'Accept': 'application/json'
                    },
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    agent: new (require('https').Agent)({ rejectUnauthorized: false })
                } as RequestInit);
            }
        }

        if (!response.ok) {
            if (response.status === 401) {
                return NextResponse.json({ error: 'Token expired' }, { status: 401 });
            }
            const text = await response.text();
            return NextResponse.json({ error: text }, { status: response.status });
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Proxy Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
