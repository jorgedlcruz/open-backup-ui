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
            return NextResponse.json({ error: 'Server configuration error: No configured Data Source' }, { status: 500 });
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

        const limit = 500;
        const url = `${baseUrl}/api/v1/backupInfrastructure/repositories?limit=${limit}`;

        let response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-api-version': '1.3-rev1',
                'Accept': 'application/json',
            },
        });

        // Auto-refresh mechanism
        if (response.status === 401 && sourceId) {
            console.log('[Repositories] 401 received, refreshing token...');
            const newToken = await tokenManager.refreshToken(sourceId);
            if (newToken) {
                response = await fetch(url, {
                    headers: {
                        'Authorization': `Bearer ${newToken}`,
                        'x-api-version': '1.3-rev1',
                        'Accept': 'application/json',
                    },
                });
            }
        }

        if (!response.ok) {
            if (response.status === 404) {
                return NextResponse.json({ data: [] });
            }
            return new NextResponse(response.statusText, { status: response.status });
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Failed to fetch repositories:', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
