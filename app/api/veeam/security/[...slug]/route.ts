
import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.VEEAM_API_URL;

async function proxyRequest(request: NextRequest, { params }: { params: { slug: string[] } }) {
    try {
        if (!API_BASE_URL) {
            return NextResponse.json(
                { error: 'Server configuration error: Missing VEEAM_API_URL' },
                { status: 500 }
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

        // Reconstruct the API path
        // request path: /api/veeam/security/users/...
        // params.slug: ['users', ...]
        // Target: /api/v1/security/users/...
        const path = params.slug.join('/');
        const { searchParams } = new URL(request.url);
        const queryString = searchParams.toString();

        const endpoint = queryString
            ? `/api/v1/security/${path}?${queryString}`
            : `/api/v1/security/${path}`;

        const fullUrl = `${API_BASE_URL}${endpoint}`;

        console.log(`[SECURITY] Proxying ${request.method} to:`, fullUrl);

        // Prepare body for non-GET/HEAD requests
        let body = undefined;
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            try {
                const text = await request.text();
                if (text) {
                    body = text;
                }
            } catch {
                // Ignore body parsing errors (empty body)
            }
        }

        const response = await fetch(fullUrl, {
            method: request.method,
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'x-api-version': '1.3-rev1',
            },
            body
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.log(`[SECURITY] Veeam error (${response.status}):`, errorText);
            try {
                const errorJson = JSON.parse(errorText);
                return NextResponse.json(errorJson, { status: response.status });
            } catch {
                return NextResponse.json(
                    { error: `Veeam API Error: ${response.status} - ${errorText}` },
                    { status: response.status }
                );
            }
        }

        // Handle 204 No Content
        if (response.status === 204) {
            return new NextResponse(null, { status: 204 });
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            return NextResponse.json(data);
        }

        const textData = await response.text();
        return new NextResponse(textData, { status: 200 });

    } catch (error) {
        console.error('[SECURITY] Proxy error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal Server Error' },
            { status: 500 }
        );
    }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
    const resolvedParams = await params;
    return proxyRequest(request, { params: resolvedParams });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
    const resolvedParams = await params;
    return proxyRequest(request, { params: resolvedParams });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
    const resolvedParams = await params;
    return proxyRequest(request, { params: resolvedParams });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
    const resolvedParams = await params;
    return proxyRequest(request, { params: resolvedParams });
}
