// API Route for Veeam Backup for Microsoft 365 Proxies
import { NextResponse } from 'next/server';
import { getVB365Config, refreshVB365Token } from '@/lib/server/vb365-helper';

export async function GET(request: Request) {
    try {
        const config = await getVB365Config();

        if (!config) {
            return NextResponse.json({ error: 'No VB365 data source configured' }, { status: 500 });
        }

        const { searchParams } = new URL(request.url);
        const query = searchParams.toString();
        const endpoint = `/v8/Proxies${query ? `?${query}` : ''}`;
        const fullUrl = `${config.baseUrl}${endpoint}`;

        let response = await fetch(fullUrl, {
            headers: { 'Authorization': `Bearer ${config.token}`, 'Accept': 'application/json' },
        });

        if (response.status === 401) {
            const newToken = await refreshVB365Token();
            if (newToken) {
                response = await fetch(fullUrl, {
                    headers: { 'Authorization': `Bearer ${newToken}`, 'Accept': 'application/json' },
                });
            }
        }

        if (!response.ok) {
            return NextResponse.json({ error: `VBM API error: ${response.status}` }, { status: response.status });
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('[VBM PROXIES] Proxy error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
