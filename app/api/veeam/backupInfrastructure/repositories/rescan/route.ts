import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.VEEAM_API_URL;

export async function POST(request: NextRequest) {
    if (!API_BASE_URL) {
        return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
        return NextResponse.json({ error: 'Authorization header required' }, { status: 401 });
    }

    const body = await request.json();
    const url = `${API_BASE_URL}/api/v1/backupInfrastructure/repositories/rescan`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': authHeader,
                'x-api-version': '1.3-rev1',
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            return new NextResponse(response.statusText, { status: response.status });
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Failed to rescan repositories:', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
