import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { VeeamRestorePoint, VeeamBackup, VeeamBackupFile } from '@/lib/types/veeam';
import { tokenManager } from '@/lib/server/token-manager';

export const dynamic = 'force-dynamic';

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

        const { searchParams } = new URL(request.url);
        const objectId = searchParams.get('objectId');
        const backupId = searchParams.get('backupId');

        // Validation: We really need at least objectId or backupId
        if (!objectId && !backupId) {
            return NextResponse.json(
                { error: 'Missing required parameter: objectId or backupId' },
                { status: 400 }
            );
        }

        // Headers common for all requests
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'x-api-version': '1.3-rev1',
        };

        // 1. Fetch Restore Points
        // We prioritise fetching by objectId using the specific endpoint as it's more accurate
        let url = '';
        const rpQueryParams = new URLSearchParams({
            limit: '500',
            sort: '-creationTime'
        });

        if (objectId) {
            console.log(`Fetching restore points for objectId: ${objectId} using /backupObjects endpoint...`);
            url = `${baseUrl}/api/v1/backupObjects/${objectId}/restorePoints?${rpQueryParams.toString()}`;
        } else if (backupId) {
            console.log(`Fetching restore points for backupId: ${backupId} using filter...`);
            rpQueryParams.append('filter', `backupId eq "${backupId}"`);
            url = `${baseUrl}/api/v1/restorePoints?${rpQueryParams.toString()}`;
        } else {
            // Should verify fallback safety
            return NextResponse.json({ data: [] });
        }

        let rpResponse = await fetch(url, {
            method: 'GET',
            headers,
        });

        // Auto-refresh mechanism
        if (rpResponse.status === 401 && sourceId) {
            console.log('[RestorePoints] 401 received, refreshing token...');
            const newToken = await tokenManager.refreshToken(sourceId);
            if (newToken) {
                headers['Authorization'] = `Bearer ${newToken}`;
                rpResponse = await fetch(url, {
                    method: 'GET',
                    headers,
                });
            }
        }

        if (!rpResponse.ok) {
            console.error(`Failed to fetch restore points from ${url}:`, await rpResponse.text());
            // If strict endpoint fails, return empty rather than crash.
            return NextResponse.json({ data: [] });
        }

        const rpResult = await rpResponse.json();
        const restorePoints: VeeamRestorePoint[] = rpResult.data;

        // Optimize: If we have no restore points, Return early
        if (restorePoints.length === 0) {
            return NextResponse.json({ data: [] });
        }

        // 2. Fetch Additional Info (Jobs, Repos, Files)
        // We need unique BackupIds to fetch Job/Repo info
        const uniqueBackupIds = Array.from(new Set(restorePoints.map(rp => rp.backupId).filter(Boolean)));

        // Cache for Backup Info
        const backupInfoMap = new Map<string, { jobName: string, repositoryName: string }>();
        // Cache for Backup Files
        const backupFilesMap = new Map<string, VeeamBackupFile[]>();

        // Fetch Backups deeply
        await Promise.all(uniqueBackupIds.map(async (bId) => {
            try {
                // Fetch Backup Details
                const backupRes = await fetch(`${baseUrl}/api/v1/backups/${bId}`, { headers });
                if (backupRes.ok) {
                    const backupData: VeeamBackup & { repositoryName?: string, repositoryId?: string } = await backupRes.json();
                    backupInfoMap.set(bId, {
                        jobName: backupData.name,
                        repositoryName: backupData.repositoryName || 'Unknown'
                    });
                }

                // Fetch Backup Files for this backup
                const filesRes = await fetch(`${baseUrl}/api/v1/backups/${bId}/backupFiles?limit=200`, { headers });
                if (filesRes.ok) {
                    const filesData = await filesRes.json();
                    backupFilesMap.set(bId, filesData.data);
                }

            } catch (e) {
                console.error(`Failed to enrich info for backup ${bId}`, e);
            }
        }));

        // 3. Merge Data
        const enrichedRestorePoints = restorePoints.map(rp => {
            const backupInfo = backupInfoMap.get(rp.backupId);

            // Try to find the matching file.
            const backupFiles = backupFilesMap.get(rp.backupId) || [];
            const matchingFile = backupFiles.find(file => {
                const fileWithRps = file as unknown as { restorePointIds?: string[] };
                return fileWithRps.restorePointIds && fileWithRps.restorePointIds.includes(rp.id);
            });

            return {
                ...rp,
                jobName: backupInfo?.jobName,
                repositoryName: backupInfo?.repositoryName,
                fileName: matchingFile?.name,
                dataSize: matchingFile?.dataSize,
                backupSize: matchingFile?.backupSize,
                dedupRatio: matchingFile?.dedupRatio,
                compressRatio: matchingFile?.compressRatio,
                pointType: (() => {
                    if (matchingFile?.name) {
                        const lowerName = matchingFile.name.toLowerCase();
                        if (lowerName.endsWith('.vbk')) return 'Full';
                        if (lowerName.endsWith('.vib')) return 'Incremental';
                        if (lowerName.endsWith('.vrb')) return 'Reverse Incremental';
                    }
                    return rp.pointType || 'Incremental'; // Fallback
                })(),
            };
        });

        return NextResponse.json({
            data: enrichedRestorePoints,
            pagination: rpResult.pagination
        });

    } catch (error) {
        console.error('Error fetching/enriching restore points:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch restore points' },
            { status: 500 }
        );
    }
}
