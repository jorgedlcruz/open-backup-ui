import { NextRequest, NextResponse } from 'next/server';

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
    try {
        const { id } = await context.params;
        const token = request.headers.get('Authorization');
        const apiUrl = process.env.VBM_API_URL || 'https://127.0.0.1:4443';

        const endpoint = `/v8/LicensedUsers/${encodeURIComponent(id)}`;
        const fullUrl = `${apiUrl}${endpoint}`;

        console.log('[VBM LICENSED_USERS] Revoking license for:', id);

        const response = await fetch(fullUrl, {
            method: 'DELETE',
            headers: {
                'Authorization': token || '',
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[VBM LICENSED_USERS] Revoke error:', response.status, errorText);
            return NextResponse.json(
                { error: `VBM API error: ${response.status} - ${errorText}` },
                { status: response.status }
            );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[VBM LICENSED_USERS] Revoke error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
