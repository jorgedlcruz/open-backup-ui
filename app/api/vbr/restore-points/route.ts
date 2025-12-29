
import { NextRequest, NextResponse } from 'next/server';
import { VeeamRestorePoint, VeeamBackup, VeeamBackupFile } from '@/lib/types/veeam';

export const dynamic = 'force-dynamic';

const API_BASE_URL = process.env.VEEAM_API_URL;

export async function GET(request: NextRequest) {
    try {
        if (!API_BASE_URL) {
            return NextResponse.json(
                { error: 'Server configuration error: Missing VEEAM_API_URL' },
                { status: 500 }
            );
        }

        const authHeader = request.headers.get('authorization');
        if (!authHeader) {
            return NextResponse.json(
                { error: 'Authorization header required' },
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
            'Authorization': authHeader,
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
            url = `${API_BASE_URL}/api/v1/backupObjects/${objectId}/restorePoints?${rpQueryParams.toString()}`;
        } else if (backupId) {
            console.log(`Fetching restore points for backupId: ${backupId} using filter...`);
            rpQueryParams.append('filter', `backupId eq "${backupId}"`);
            url = `${API_BASE_URL}/api/v1/restorePoints?${rpQueryParams.toString()}`;
        } else {
            // Should verify fallback safety
            return NextResponse.json({ data: [] });
        }

        const rpResponse = await fetch(url, {
            method: 'GET',
            headers,
        });

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
                const backupRes = await fetch(`${API_BASE_URL}/api/v1/backups/${bId}`, { headers });
                if (backupRes.ok) {
                    const backupData: VeeamBackup & { repositoryName?: string, repositoryId?: string } = await backupRes.json();
                    // Depending on API version, repositoryName might be directly on backup object or we might need to fetch it.
                    // Based on user provided JSON in prompt, /backups result has repositoryName.
                    // Let's assume GET /backups/{id} also returns it.
                    backupInfoMap.set(bId, {
                        jobName: backupData.name,
                        repositoryName: backupData.repositoryName || 'Unknown'
                    });
                }

                // Fetch Backup Files for this backup
                // We need this to match files to restore points for Size info
                const filesRes = await fetch(`${API_BASE_URL}/api/v1/backups/${bId}/backupFiles?limit=200`, { headers });
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
            // Logic: A restore point roughly corresponds to a Backup File created around the same time or linked via IDs.
            // However, API linking isn't always direct 1:1 in ID references between RP and File.
            // BackupFile has 'restorePointIds' array? Let's check the user provided JSON.
            // Yes! User JSON for BackupFiles: "restorePointIds": ["..."]
            // So we can find the file that contains this restore point ID.

            const backupFiles = backupFilesMap.get(rp.backupId) || [];
            const matchingFile = backupFiles.find(file => {
                // The user JSON shows backupFile has restorePointIds array.
                // We need to check if VeeamBackupFile type has it, if not we treat it as unknown/any for now
                const fileWithRps = file as unknown as { restorePointIds?: string[] };
                return fileWithRps.restorePointIds && fileWithRps.restorePointIds.includes(rp.id);
            });

            return {
                ...rp,
                jobName: backupInfo?.jobName,
                repositoryName: backupInfo?.repositoryName,
                // If we found a file, use its stats
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
