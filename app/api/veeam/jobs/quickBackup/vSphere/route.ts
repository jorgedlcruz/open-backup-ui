import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const authHeader = request.headers.get('authorization');

        if (!authHeader) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const vbrUrl = process.env.VEEAM_API_URL;
        if (!vbrUrl) {
            return NextResponse.json({ error: 'VEEAM_API_URL not configured' }, { status: 500 });
        }

        const vbrResponse = await fetch(`${vbrUrl}/api/v1/jobs/quickBackup/vSphere`, {
            method: 'POST',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json',
                'x-api-version': '1.3-rev1'
            },
            body: JSON.stringify(body)
        });

        if (!vbrResponse.ok) {
            const errorText = await vbrResponse.text().catch(() => '');
            return NextResponse.json(
                { error: `Veeam API Error: ${vbrResponse.status} - ${errorText}` },
                { status: vbrResponse.status }
            );
        }

        return NextResponse.json({ success: true, message: 'Quick Backup initiated successfully' });

    } catch (error: unknown) {
        console.error('Error starting quick backup:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}
