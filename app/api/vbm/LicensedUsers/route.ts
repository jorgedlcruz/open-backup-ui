import { NextRequest, NextResponse } from 'next/server';
import { getVB365Config, refreshVB365Token } from '@/lib/server/vb365-helper';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const config = await getVB365Config();

        if (!config) {
            return NextResponse.json({ error: 'No VB365 data source configured' }, { status: 500 });
        }

        const { searchParams } = new URL(request.url);
        const query = searchParams.toString();
        const endpoint = `/v8/LicensedUsers${query ? `?${query}` : ''}`;
        const fullUrl = `${config.baseUrl}${endpoint}`;

        console.log('[VBM LICENSED_USERS] Fetching from:', fullUrl);

        let response = await fetch(fullUrl, {
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Accept': 'application/json'
            },
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            agent: new (require('https').Agent)({ rejectUnauthorized: false })
        } as RequestInit);

        if (response.status === 401) {
            console.log('[VBM LICENSED_USERS] 401 received, refreshing token...');
            const newToken = await refreshVB365Token();
            if (newToken) {
                response = await fetch(fullUrl, {
                    headers: {
                        'Authorization': `Bearer ${newToken}`,
                        'Accept': 'application/json'
                    },
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    agent: new (require('https').Agent)({ rejectUnauthorized: false })
                } as RequestInit);
            }
        }

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[VBM LICENSED_USERS] API error:', response.status, fullUrl, errorText);
            return NextResponse.json(
                { error: `VBM API error: ${response.status}` },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('[VBM LICENSED_USERS] Proxy error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
