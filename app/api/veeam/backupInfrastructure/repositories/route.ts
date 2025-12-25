import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.VEEAM_API_URL;

export async function GET(request: NextRequest) {
    if (!API_BASE_URL) {
        return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
        return NextResponse.json({ error: 'Authorization header required' }, { status: 401 });
    }

    const limit = 500;
    const url = `${API_BASE_URL}/api/v1/backupInfrastructure/repositories?limit=${limit}`;

    try {
        const response = await fetch(url, {
            headers: {
                'Authorization': authHeader,
                'x-api-version': '1.3-rev1',
                'Accept': 'application/json',
            },
        });

        if (!response.ok) {
            if (response.status === 404) {
                return NextResponse.json({ data: [] });
            }
            return new NextResponse(response.statusText, { status: response.status });
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Failed to fetch repositories:', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
