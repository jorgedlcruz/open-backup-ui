import { NextRequest, NextResponse } from 'next/server'
import { veeamOneClient } from '@/lib/api/veeam-one-client'

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        const { taskId, sectionId, sessionId, resourceId } = await request.json()

        if (!taskId || !sectionId || !sessionId || !resourceId) {
            return NextResponse.json(
                { error: 'Missing required parameters' },
                { status: 400 }
            )
        }

        const data = await veeamOneClient.getReportSectionData(
            taskId,
            sectionId,
            sessionId,
            resourceId
        )

        return NextResponse.json(data || { items: [], totalCount: 0 })
    } catch (error) {
        console.error('[API] Error fetching report section:', error)
        return NextResponse.json(
            { error: 'Failed to fetch report section data' },
            { status: 500 }
        )
    }
}
