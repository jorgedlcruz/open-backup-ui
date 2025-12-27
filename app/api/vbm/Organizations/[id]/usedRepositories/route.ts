// API Route for Veeam Backup for Microsoft 365 Organization Used Repositories
// This route proxies requests to the VBM365 API to avoid CORS issues

import { NextRequest, NextResponse } from 'next/server';
import type { VBMUsedRepositoriesResponse } from '@/lib/types/vbm';

const VBM_API_URL = process.env.VBM_API_URL;

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        if (!VBM_API_URL) {
            return NextResponse.json(
                { error: 'Server configuration error: Missing VBM_API_URL' },
                { status: 500 }
            );
        }

        const { id } = await params;

        if (!id) {
            return NextResponse.json(
                { error: 'Organization ID is required' },
                { status: 400 }
            );
        }

        // Get authorization header from the request
        const authHeader = request.headers.get('authorization');

        if (!authHeader) {
            return NextResponse.json(
                { error: 'Authorization header required' },
                { status: 401 }
            );
        }

        // Extract query parameters and forward them all
        const { searchParams } = new URL(request.url);

        // Ensure we're targeting the correct endpoint version
        // Typically VBM uses /v8/Organizations/{id}/usedRepositories
        const endpoint = `/v8/Organizations/${id}/usedRepositories?${searchParams.toString()}`;
        const fullUrl = `${VBM_API_URL}${endpoint}`;

        console.log('[VBM ORG REPOS] Fetching from:', fullUrl);

        const response = await fetch(fullUrl, {
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json',
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[VBM ORG REPOS] API error:', response.status, errorText);
            return NextResponse.json(
                { error: `VBM365 API error: ${response.status} - ${errorText}` },
                { status: response.status }
            );
        }

        const data: VBMUsedRepositoriesResponse = await response.json();

        console.log(`[VBM ORG REPOS] Retrieved ${data.results?.length || 0} used repositories`);

        return NextResponse.json(data);

    } catch (error) {
        console.error('[VBM ORG REPOS] Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch VBM used repositories' },
            { status: 500 }
        );
    }
}
