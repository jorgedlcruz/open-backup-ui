import { NextRequest, NextResponse } from 'next/server'
import { veeamOneClient } from '@/lib/api/veeam-one-client'

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        const { taskId, sessionId, resourceId } = await request.json()

        if (!taskId || !sessionId || !resourceId) {
            return NextResponse.json(
                { error: 'Missing required parameters' },
                { status: 400 }
            )
        }

        const data = await veeamOneClient.getReportParameters(
            taskId,
            sessionId,
            resourceId
        )

        return NextResponse.json({ items: data || [] })
    } catch (error) {
        console.error('[API] Error fetching report parameters:', error)
        return NextResponse.json(
            { error: 'Failed to fetch report parameters' },
            { status: 500 }
        )
    }
}
