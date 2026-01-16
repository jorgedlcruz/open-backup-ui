// API Route for Veeam Backup for Microsoft 365 Organization Used Repositories
import { NextResponse } from 'next/server';
import { getVB365Config, refreshVB365Token } from '@/lib/server/vb365-helper';
import type { VBMUsedRepositoriesResponse } from '@/lib/types/vbm';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const config = await getVB365Config();

        if (!config) {
            return NextResponse.json({ error: 'No VB365 data source configured' }, { status: 500 });
        }

        const { id } = await params;

        if (!id) {
            return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
        }

        const { searchParams } = new URL(request.url);
        const endpoint = `/v8/Organizations/${id}/usedRepositories?${searchParams.toString()}`;
        const fullUrl = `${config.baseUrl}${endpoint}`;

        let response = await fetch(fullUrl, {
            headers: { 'Authorization': `Bearer ${config.token}`, 'Accept': 'application/json' },
        });

        if (response.status === 401) {
            const newToken = await refreshVB365Token();
            if (newToken) {
                response = await fetch(fullUrl, {
                    headers: { 'Authorization': `Bearer ${newToken}`, 'Accept': 'application/json' },
                });
            }
        }

        if (!response.ok) {
            return NextResponse.json({ error: `VBM365 API error: ${response.status}` }, { status: response.status });
        }

        const data: VBMUsedRepositoriesResponse = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('[VBM ORG REPOS] Error:', error);
        return NextResponse.json({ error: 'Failed to fetch VBM used repositories' }, { status: 500 });
    }
}
