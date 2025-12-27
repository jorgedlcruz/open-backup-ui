import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.VEEAM_API_URL;

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    if (!API_BASE_URL) {
        return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
        return NextResponse.json({ error: 'Authorization header required' }, { status: 401 });
    }

    const { id } = await params; // await params in Next 15+

    const url = `${API_BASE_URL}/api/v1/backupInfrastructure/repositories/${id}`;

    try {
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Authorization': authHeader,
                'x-api-version': '1.3-rev1',
                'Accept': 'application/json',
            },
        });

        if (!response.ok) {
            return new NextResponse(response.statusText, { status: response.status });
        }

        if (response.status === 204) {
            return new NextResponse(null, { status: 204 });
        }

        const text = await response.text();
        if (!text) return new NextResponse(null, { status: 200 });

        return NextResponse.json(JSON.parse(text));
    } catch (error) {
        console.error(`Failed to delete repository ${id}:`, error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
