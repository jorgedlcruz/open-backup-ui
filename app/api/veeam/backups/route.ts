
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API_BASE_URL = process.env.VEEAM_API_URL;

export async function GET(request: NextRequest) {
    try {
        if (!API_BASE_URL) {
            return NextResponse.json(
                { error: 'Server configuration error: Missing VEEAM_API_URL' },
                { status: 500 }
            );
        }

        const authHeader = request.headers.get('authorization');
        if (!authHeader) {
            return NextResponse.json(
                { error: 'Authorization header required' },
                { status: 401 }
            );
        }

        const { searchParams } = new URL(request.url);
        const queryString = searchParams.toString();
        const endpoint = queryString ? `/api/v1/backups?${queryString}` : '/api/v1/backups';
        const fullUrl = `${API_BASE_URL}${endpoint}`;

        const response = await fetch(fullUrl, {
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'x-api-version': '1.3-rev1',
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[BACKUPS] Veeam error:', errorText);
            return NextResponse.json(
                { error: `Failed to fetch backups: ${response.status} - ${errorText}` },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (error) {
        console.error('Error fetching backups:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch backups' },
            { status: 500 }
        );
    }
}
