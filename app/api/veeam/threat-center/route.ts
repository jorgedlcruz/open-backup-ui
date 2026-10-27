import { NextResponse } from 'next/server';
import { VeeamApiClient } from '@/lib/api/veeam-client';
import { cookies } from 'next/headers';
import { tokenManager } from '@/lib/server/token-manager';
import { getChunkedCookie } from '@/lib/utils/cookie-manager';

export const dynamic = 'force-dynamic';

export interface AnomalyRecord {
    id: string;
    vmName: string;
    sessionId: string;
    sessionName: string;
    creationTime: string;
    readSize: number;
    transferredSize: number;
    dedupeRatio: number;
    reason: string;
    score: number;
    severity: 'critical' | 'warning' | 'info';
}

export async function GET() {
    try {
        const cookieStore = await cookies();
        const sourceId = cookieStore.get('veeam_source_id')?.value;
        let token = getChunkedCookie(cookieStore, 'veeam_vbr_token');
        if (sourceId) {
            token = await tokenManager.getToken(sourceId) || token;
        }

        if (!token) {
            return NextResponse.json({ error: 'Authorization required. Please log in again.' }, { status: 401 });
        }

        const serverVeeamApi = new VeeamApiClient();
        serverVeeamApi.setToken(token);

        // Forward cookies so the proxy API can read them (e.g. veeam_vbr_token_url)
        const cookieStr = cookieStore.getAll().map(c => `${c.name}=${c.value}`).join('; ');
        serverVeeamApi.setServerHeaders({ 'Cookie': cookieStr });

        // Fetch the last 30 sessions to analyze
        const sessions = await serverVeeamApi.getSessions({ limit: 30 });

        const anomalies: AnomalyRecord[] = [];
        let totalScannedTasks = 0;
        let globalRead = 0;
        let globalTransferred = 0;

        // Use Promise.all to fetch tasks concurrently for better performance
        const taskPromises = sessions.map(session =>
            serverVeeamApi.getSessionTasks(session.id)
                .catch(err => {
                    console.warn(`Failed to fetch tasks for session ${session.id}:`, err);
                    return [];
                })
        );

        const allSessionTasks = await Promise.all(taskPromises);

        sessions.forEach((session, index) => {
            const tasks = allSessionTasks[index];
            if (!tasks || tasks.length === 0) return;

            tasks.forEach(task => {
                totalScannedTasks++;

                const readSize = task.progress?.readSize || 0;
                const transferredSize = task.progress?.transferredSize || 0;

                globalRead += readSize;
                globalTransferred += transferredSize;

                // Heuristic 1: High Entropy (Uncompressible Data)
                // If a VM transfers more than 1GB and achieves less than 15% reduction (transferred/read > 0.85)
                // This is highly indicative of encrypted (Ransomware) or pre-compressed data
                if (readSize > 1024 * 1024 * 1024) { // Only analyze tasks > 1GB to avoid noise
                    const reductionRatio = transferredSize / readSize;

                    if (reductionRatio > 0.85) {
                        anomalies.push({
                            id: task.id,
                            vmName: task.name,
                            sessionId: session.id,
                            sessionName: session.name,
                            creationTime: task.creationTime,
                            readSize: readSize,
                            transferredSize: transferredSize,
                            dedupeRatio: reductionRatio,
                            reason: `Highly uncompressible data detected (${(reductionRatio * 100).toFixed(1)}% ratio). Possible encryption.`,
                            score: Math.min(100, Math.floor(reductionRatio * 100)),
                            severity: reductionRatio > 0.95 ? 'critical' : 'warning'
                        });
                    }
                }
            });
        });

        // Sort anomalies by score descending
        anomalies.sort((a, b) => b.score - a.score);

        return NextResponse.json({
            anomalies,
            metadata: {
                scannedSessions: sessions.length,
                scannedTasks: totalScannedTasks,
                globalDataReduction: globalTransferred > 0 ? (globalRead / globalTransferred) : 1
            }
        });

    } catch (error: unknown) {
        console.error('Threat Center API Error:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to fetch threat intelligence' }, { status: 500 });
    }
}
