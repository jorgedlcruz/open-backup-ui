
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        // Check Authorization header first
        const authHeader = request.headers.get('Authorization');
        let tokenValue = '';

        if (authHeader && authHeader.startsWith('Bearer ')) {
            tokenValue = authHeader.split(' ')[1];
        } else {
            const cookieStore = await cookies();
            const tokenCookie = cookieStore.get('vbr_access_token');
            if (tokenCookie) tokenValue = tokenCookie.value;
        }

        if (!tokenValue) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        // Read the body from the request if provided, otherwise default to json
        let body = { reportFormat: 'json' };
        try {
            const reqBody = await request.json();
            if (reqBody) body = reqBody;
        } catch {
            // ignore if empty body
        }

        const acceptHeader = request.headers.get('Accept') || 'application/json';

        const host = process.env.VEEAM_API_URL || process.env.VBR_API_URL || 'https://192.168.1.50:9419';
        const response = await fetch(`${host}/api/v1/license/createReport`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokenValue}`,
                'x-api-version': '1.3-rev1',
                'Content-Type': 'application/json',
                'Accept': acceptHeader
            },
            body: JSON.stringify(body),
            agent: new (require('https').Agent)({ rejectUnauthorized: false }) // eslint-disable-line @typescript-eslint/no-require-imports
        } as RequestInit);

        if (!response.ok) {
            const text = await response.text();
            return NextResponse.json({ error: text }, { status: response.status });
        }

        const responseContentType = response.headers.get('content-type');
        if (responseContentType && responseContentType.includes('application/json')) {
            const data = await response.json();
            return NextResponse.json(data);
        } else {
            // Return raw response for HTML/text/blob
            const data = await response.arrayBuffer();
            return new NextResponse(data, {
                status: 200,
                headers: {
                    'Content-Type': responseContentType || 'application/octet-stream'
                }
            });
        }
    } catch (error) {
        console.error('Proxy Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
