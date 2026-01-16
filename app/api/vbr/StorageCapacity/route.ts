import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { tokenManager } from '@/lib/server/token-manager';
import { VeeamBackupFile } from '@/lib/types/veeam';

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
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('[StorageCapacity] Fetching backups...');

        // 1. Fetch Backups directly
        let backupsRes = await fetch(`${baseUrl}/api/v1/backups?limit=500`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'x-api-version': '1.3-rev1',
            }
        });

        // Auto-refresh mechanism
        if (backupsRes.status === 401 && sourceId) {
            console.log('[StorageCapacity] 401 received, refreshing token...');
            const newToken = await tokenManager.refreshToken(sourceId);
            if (newToken) {
                token = newToken; // Update local token variable used for subsequent calls
                backupsRes = await fetch(`${baseUrl}/api/v1/backups?limit=500`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/json',
                        'x-api-version': '1.3-rev1',
                    }
                });
            }
        }

        if (!backupsRes.ok) throw new Error(`Failed to fetch backups: ${backupsRes.status}`);
        const backupsData = await backupsRes.json();
        const backups = backupsData.data || [];
        console.log(`[StorageCapacity] Found ${backups.length} backups`);

        // 2. Fetch files for each backup
        const backupFilesPromises: (() => Promise<VeeamBackupFile[]>)[] = backups.map((backup: { id: string }) => async () => {
            try {
                // Determine token to use (in case it was refreshed)
                const currentToken = token as string;
                const filesRes = await fetch(`${baseUrl}/api/v1/backups/${backup.id}/backupFiles?limit=500`, {
                    headers: {
                        'Authorization': `Bearer ${currentToken}`,
                        'Accept': 'application/json',
                        'x-api-version': '1.3-rev1',
                    }
                });
                if (!filesRes.ok) {
                    if (filesRes.status === 401) {
                        // If token expired mid-process (unlikely given we just refreshed, but possible if long running)
                        // We fail gracefully here rather than complexity of re-refreshing loop in map
                        console.warn(`Token expired while fetching files for backup ${backup.id}`);
                        return [];
                    }
                    return [];
                }
                const filesData = await filesRes.json();
                return filesData.data || [];
            } catch (e) {
                console.error(`Failed to fetch files for backup ${backup.id}`, e);
                return [];
            }
        });

        const chunkArray = <T>(arr: T[], size: number): T[][] => {
            return Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
                arr.slice(i * size, i * size + size)
            );
        };

        const chunks = chunkArray(backupFilesPromises, 10);
        const allFiles: VeeamBackupFile[] = [];

        for (const chunk of chunks) {
            const results = await Promise.all(chunk.map(fn => fn()));
            results.forEach((files: VeeamBackupFile[]) => allFiles.push(...files));
        }

        // 3. Calculate Stats
        let totalBackupSize = 0;
        let totalDataSize = 0;
        let totalDedupRatio = 0;
        let totalCompressRatio = 0;
        let fileCount = 0;

        allFiles.forEach((file: VeeamBackupFile) => {
            totalBackupSize += file.backupSize;
            totalDataSize += file.dataSize;
            totalDedupRatio += file.dedupRatio;
            totalCompressRatio += file.compressRatio;
            fileCount++;
        });

        const avgDedupRatio = fileCount > 0 ? Math.round(totalDedupRatio / fileCount) : 0;
        const avgCompressRatio = fileCount > 0 ? Math.round(totalCompressRatio / fileCount) : 0;

        const result = {
            totalBackupSize,
            totalDataSize,
            avgDedupRatio,
            avgCompressRatio,
            fileCount,
            backupCount: backups.length
        };

        return NextResponse.json(result);

    } catch (error) {
        console.error('Error calculating storage capacity:', error);
        return NextResponse.json(
            { error: 'Failed to calculate storage capacity' },
            { status: 500 }
        );
    }
}
