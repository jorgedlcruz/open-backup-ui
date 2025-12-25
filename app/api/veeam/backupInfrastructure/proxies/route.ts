import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.VEEAM_API_URL;

async function proxy(request: NextRequest) {
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
        const endpoint = queryString ? `/api/v1/backupInfrastructure/proxies?${queryString}` : `/api/v1/backupInfrastructure/proxies`;
        const fullUrl = `${API_BASE_URL}${endpoint}`;

        const options: RequestInit = {
            method: request.method,
            headers: {
                'Authorization': authHeader,
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

        const response = await fetch(fullUrl, options);

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
        console.error('[PROXIES PROXY] Internal Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal Server Error' },
            { status: 500 }
        );
    }
}

export { proxy as GET, proxy as POST };
