import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { BackupObjectsResult, VeeamProtectedWorkload } from '@/lib/types/veeam';
import { tokenManager } from '@/lib/server/token-manager';

export const dynamic = 'force-dynamic'; // Prevent caching so data is fresh

// Simple in-memory cache
let cachedData: {
    data: VeeamProtectedWorkload[];
    timestamp: number;
} | null = null;

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function GET(request: NextRequest) {
    try {
        const cookieStore = await cookies();
        const sourceId = cookieStore.get('veeam_source_id')?.value;
        const cookieUrl = cookieStore.get('veeam_vbr_token_url')?.value;
        const baseUrl = cookieUrl || process.env.VEEAM_API_URL;

        if (!baseUrl && !sourceId) {
            return NextResponse.json(
                { error: 'Server configuration error: No configured Data Source' },
                { status: 500 }
            );
        }

        let token: string | null = null;
        if (sourceId) {
            token = await tokenManager.getToken(sourceId);
        }

        if (!token) {
            const authHeader = request.headers.get('authorization');
            if (authHeader?.startsWith('Bearer ')) {
                token = authHeader.substring(7);
            }
        }

        if (!token) {
            return NextResponse.json(
                { error: 'Authorization required' },
                { status: 401 }
            );
        }

        // Check cache
        const now = Date.now();
        const { searchParams } = new URL(request.url);
        const forceRefresh = searchParams.get('refresh') === 'true';

        if (cachedData && !forceRefresh && (now - cachedData.timestamp < CACHE_TTL)) {
            console.log('Serving protected data from cache');
            return NextResponse.json({ data: cachedData.data });
        }

        // Use the optimized /backupObjects endpoint
        console.log('Fetching protected objects from /backupObjects...');
        let response = await fetch(`${baseUrl}/api/v1/backupObjects?limit=1000`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'x-api-version': '1.3-rev1',
            },
        });

        // Auto-refresh mechanism
        if (response.status === 401 && sourceId) {
            console.log('[ProtectedData] 401 received, refreshing token...');
            const newToken = await tokenManager.refreshToken(sourceId);
            if (newToken) {
                response = await fetch(`${baseUrl}/api/v1/backupObjects?limit=1000`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${newToken}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'x-api-version': '1.3-rev1',
                    },
                });
            }
        }

        if (!response.ok) {
            console.error('Failed to fetch backup objects:', await response.text());
            return NextResponse.json({ data: [] });
        }

        const result: BackupObjectsResult = await response.json();
        const objects = result.data;

        // Map to VeeamProtectedWorkload
        const protectedWorkloads: VeeamProtectedWorkload[] = objects.map(obj => ({
            ...obj,
        }));

        // Sort by name
        protectedWorkloads.sort((a, b) => a.name.localeCompare(b.name));

        // Update cache
        cachedData = {
            data: protectedWorkloads,
            timestamp: Date.now()
        };

        console.log(`Cached ${protectedWorkloads.length} protected workloads`);

        return NextResponse.json({
            data: protectedWorkloads,
            total: protectedWorkloads.length
        });

    } catch (error) {
        console.error('Error fetching protected data:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch protected data' },
            { status: 500 }
        );
    }
}
