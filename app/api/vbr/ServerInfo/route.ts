import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { tokenManager } from '@/lib/server/token-manager';

export async function GET(request: NextRequest) {
    try {
        const cookieStore = await cookies();
        const sourceId = cookieStore.get('veeam_source_id')?.value;
        const cookieUrl = cookieStore.get('veeam_vbr_token_url')?.value;
        const baseUrl = cookieUrl || process.env.VEEAM_API_URL;

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
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const fullUrl = `${baseUrl}/api/v1/serverInfo`;
        let response = await fetch(fullUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'x-api-version': '1.3-rev1',
            }
        });

        // Auto-refresh mechanism
        if (response.status === 401 && sourceId) {
            console.log('[ServerInfo] 401 received, refreshing token...');
            const newToken = await tokenManager.refreshToken(sourceId);
            if (newToken) {
                response = await fetch(fullUrl, {
                    headers: {
                        'Authorization': `Bearer ${newToken}`,
                        'Accept': 'application/json',
                        'x-api-version': '1.3-rev1',
                    }
                });
            }
        }

        if (!response.ok) {
            if (response.status === 401) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
            throw new Error(`Failed to fetch server info: ${response.status}`);
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (error) {
        console.error('Error fetching server info:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch server info' },
            { status: 500 }
        );
    }
}
