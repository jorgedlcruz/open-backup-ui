// API Route for Veeam Backup for Microsoft 365 Job Sessions
import { NextResponse } from 'next/server';
import { getVB365Config, refreshVB365Token } from '@/lib/server/vb365-helper';
import type { VBMJobSessionsResponse } from '@/lib/types/vbm';

export async function GET(request: Request) {
    try {
        const config = await getVB365Config();

        if (!config) {
            return NextResponse.json({ error: 'No VB365 data source configured' }, { status: 500 });
        }

        const { searchParams } = new URL(request.url);
        const endpoint = `/v8/JobSessions?${searchParams.toString()}`;
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
            const errorText = await response.text();
            console.error('[VBM SESSIONS] API error:', response.status, errorText);
            return NextResponse.json({ error: `VBM365 API error: ${response.status}` }, { status: response.status });
        }

        const data: VBMJobSessionsResponse = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('[VBM SESSIONS] Error:', error);
        return NextResponse.json({ error: 'Failed to fetch VBM sessions' }, { status: 500 });
    }
}
