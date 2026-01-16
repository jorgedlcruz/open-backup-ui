// API Route for Veeam Backup for Microsoft 365 Restore Points
// This route proxies requests to the VBM365 API

import { NextRequest, NextResponse } from 'next/server';
import { getVB365Config, refreshVB365Token } from '@/lib/server/vb365-helper';

export async function GET(request: NextRequest) {
    try {
        const config = await getVB365Config();

        if (!config) {
            return NextResponse.json(
                { error: 'No VB365 data source configured' },
                { status: 500 }
            );
        }

        const { searchParams } = new URL(request.url);
        const endpoint = `/v8/RestorePoints?${searchParams.toString()}`;
        const fullUrl = `${config.baseUrl}${endpoint}`;

        console.log('[VBM RESTORE POINTS] Fetching from:', fullUrl);

        let response = await fetch(fullUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Accept': 'application/json',
            },
        });

        // On 401, refresh token and retry
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
            console.error('[VBM RESTORE POINTS] API error:', response.status, errorText);
            return NextResponse.json(
                { error: `VBM365 API error: ${response.status} - ${errorText}` },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (error) {
        console.error('[VBM RESTORE POINTS] Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch VBM restore points' },
            { status: 500 }
        );
    }
}
