// API Route for Veeam Authorization Events
// This route proxies requests to the Veeam API for authorization events

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { tokenManager } from '@/lib/server/token-manager';

export const dynamic = 'force-dynamic';

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
            return NextResponse.json(
                { error: 'Authorization required' },
                { status: 401 }
            );
        }

        // Extract query parameters
        const { searchParams } = new URL(request.url);
        const queryString = searchParams.toString();
        const endpoint = queryString
            ? `/api/v1/authorization/events?${queryString}`
            : '/api/v1/authorization/events';

        const fullUrl = `${baseUrl}${endpoint}`;

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
            console.log('[Authorization Events] 401 received, refreshing token...');
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

            if (response.status === 403) {
                return NextResponse.json(
                    {
                        error: 'Permission denied: User lacks required permissions to view authorization events',
                        details: 'The current user does not have the required Veeam Backup Administrator or Veeam Security Administrator role',
                        veeamError: errorText
                    },
                    { status: 403 }
                );
            }

            return NextResponse.json(
                { error: `Failed to fetch authorization events: ${response.status} - ${errorText}` },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (error) {
        console.error('Error fetching authorization events:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch authorization events' },
            { status: 500 }
        );
    }
}
