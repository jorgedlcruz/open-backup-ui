import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { tokenManager } from '@/lib/server/token-manager';

async function proxy(request: NextRequest) {
    try {
        const cookieStore = await cookies();
        const sourceId = cookieStore.get('veeam_source_id')?.value;
        const cookieUrl = cookieStore.get('veeam_vbr_token_url')?.value;
        const baseUrl = cookieUrl || process.env.VEEAM_API_URL;

        if (!sourceId && !baseUrl) {
            return NextResponse.json(
                { error: 'Server configuration error: No configured Data Source' },
                { status: 500 }
            );
        }

        // Token strategy:
        // 1. If sourceId exists, use tokenManager (Preferred)
        // 2. Else fallback to cookie-passed token (Legacy/Env)

        let token: string | null = null;
        if (sourceId) {
            token = await tokenManager.getToken(sourceId);
        }

        // If no server-side token, try header or legacy cookie (omitted for strictness, but let's check header as fallback)
        if (!token) {
            const authHeader = request.headers.get('authorization');
            if (authHeader?.startsWith('Bearer ')) {
                token = authHeader.substring(7);
            }
        }

        if (!token) {
            return NextResponse.json(
                { error: 'Authentication required. Please add a Data Source.' },
                { status: 401 }
            );
        }

        const { searchParams } = new URL(request.url);
        const queryString = searchParams.toString();
        const endpoint = queryString ? `/api/v1/inventory?${queryString}` : `/api/v1/inventory`;
        const fullUrl = `${baseUrl}${endpoint}`;

        const options: RequestInit = {
            method: request.method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'x-api-version': '1.3-rev1',
            },
        };

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            const text = await request.text();
            if (text) {
                options.body = text;
            }
        }

        let response = await fetch(fullUrl, options);

        // Auto-refresh mechanism
        if (response.status === 401 && sourceId) {
            console.log('[Proxy] 401 received, refreshing token...');
            const newToken = await tokenManager.refreshToken(sourceId);
            if (newToken) {
                options.headers = {
                    ...options.headers,
                    'Authorization': `Bearer ${newToken}`
                };
                response = await fetch(fullUrl, options);
            }
        }

        if (response.status === 204) {
            return new NextResponse(null, { status: 204 });
        }

        const responseText = await response.text();
        let data;
        try {
            data = responseText ? JSON.parse(responseText) : {};
        } catch {
            data = { error: responseText };
        }

        if (!response.ok) {
            return NextResponse.json(data, { status: response.status });
        }

        return NextResponse.json(data);

    } catch (error) {
        console.error('[INVENTORY ROOT PROXY] Internal Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal Server Error' },
            { status: 500 }
        );
    }
}

export { proxy as GET, proxy as POST };
