import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { tokenManager } from '@/lib/server/token-manager';

export const dynamic = 'force-dynamic';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
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
            return NextResponse.json(
                { error: 'Authorization required' },
                { status: 401 }
            );
        }

        const { id } = await params;
        const fullUrl = `${baseUrl}/api/v1/backups/${id}/backupFiles?limit=500`;

        let response = await fetch(fullUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'x-api-version': '1.3-rev1',
            },
        });

        // Auto-refresh mechanism
        if (response.status === 401 && sourceId) {
            console.log(`[BackupFiles ${id}] 401 received, refreshing token...`);
            const newToken = await tokenManager.refreshToken(sourceId);
            if (newToken) {
                response = await fetch(fullUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${newToken}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'x-api-version': '1.3-rev1',
                    },
                });
            }
        }

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Failed to fetch backup files for backup ${id}:`, errorText);
            return NextResponse.json(
                { error: `Veeam API error: ${response.status}` },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (error) {
        console.error('Error fetching backup files:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch backup files' },
            { status: 500 }
        );
    }
}
