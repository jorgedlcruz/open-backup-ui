import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { tokenManager } from '@/lib/server/token-manager';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const cookieStore = await cookies();
        const sourceId = cookieStore.get('veeam_source_id')?.value;
        const cookieUrl = cookieStore.get('veeam_vbr_token_url')?.value;
        const baseUrl = cookieUrl || process.env.VEEAM_API_URL?.replace(/['\"]/g, '').replace(/[\\/\\s]+$/, '');

        if (!baseUrl && !sourceId) {
            return NextResponse.json(
                { error: 'Server configuration error: No configured Data Source' },
                { status: 500 }
            );
        }

        // Try to get token from tokenManager first
        let token: string | null = null;
        if (sourceId) {
            token = await tokenManager.getToken(sourceId);
        }

        // Fallback to authorization header
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

        const searchParams = request.nextUrl.searchParams;
        const queryString = searchParams.toString();
        const endpoint = queryString
            ? `/api/v1/sessions/${id}/taskSessions?${queryString}`
            : `/api/v1/sessions/${id}/taskSessions`;

        const response = await fetch(`${baseUrl}${endpoint}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'x-api-version': '1.3-rev1',
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            return NextResponse.json(
                { error: `Failed to fetch task sessions: ${response.status} - ${errorText}` },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (error) {
        console.error('Error fetching task sessions:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch task sessions' },
            { status: 500 }
        );
    }
}
