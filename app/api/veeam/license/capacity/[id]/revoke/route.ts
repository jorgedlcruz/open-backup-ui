
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const instanceId = id;
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

        const host = process.env.VEEAM_API_URL || process.env.VBR_API_URL || 'https://192.168.1.50:9419';
        const response = await fetch(`${host}/api/v1/license/capacity/${instanceId}/revoke`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokenValue}`,
                'x-api-version': '1.3-rev1',
                'Accept': 'application/json'
            },
            agent: new (require('https').Agent)({ rejectUnauthorized: false }) // eslint-disable-line @typescript-eslint/no-require-imports
        } as RequestInit);

        if (!response.ok) {
            const text = await response.text();
            return NextResponse.json({ error: text }, { status: response.status });
        }

        return NextResponse.json({});
    } catch (error) {
        console.error('Proxy Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
