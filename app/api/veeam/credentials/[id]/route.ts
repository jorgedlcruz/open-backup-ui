import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.VEEAM_API_URL;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

        const { id } = await params;
        const endpoint = `/api/v1/credentials/${id}`;
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
            return NextResponse.json(
                { error: `Failed to fetch credential: ${response.status} - ${errorText}` },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (error) {
        console.error('Error fetching credential:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch credential' },
            { status: 500 }
        );
    }
}
