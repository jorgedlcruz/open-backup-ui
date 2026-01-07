import { NextRequest, NextResponse } from 'next/server';

interface RouteContext {
    params: Promise<{ id: string }>;
}

// Rescan proxy
export async function POST(request: NextRequest, context: RouteContext) {
    try {
        const { id } = await context.params;
        const token = request.headers.get('Authorization');
        const apiUrl = process.env.VBM_API_URL || 'https://127.0.0.1:4443';

        // Get action from request body
        const body = await request.json().catch(() => ({}));
        const action = body.action || 'rescan';

        let endpoint = `/v8/Proxies/${encodeURIComponent(id)}`;
        if (action === 'rescan') {
            endpoint += '/Rescan';
        } else if (action === 'enableMaintenance') {
            endpoint += '/maintenance/enable';
        } else if (action === 'disableMaintenance') {
            endpoint += '/maintenance/disable';
        }

        const fullUrl = `${apiUrl}${endpoint}`;
        console.log('[VBM PROXIES] Action:', action, 'for:', id);

        const response = await fetch(fullUrl, {
            method: 'POST',
            headers: {
                'Authorization': token || '',
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[VBM PROXIES] Action error:', response.status, errorText);
            return NextResponse.json(
                { error: `VBM API error: ${response.status} - ${errorText}` },
                { status: response.status }
            );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[VBM PROXIES] Action error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
