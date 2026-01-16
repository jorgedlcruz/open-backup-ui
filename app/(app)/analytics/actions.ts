'use server'

import { veeamOneClient } from "@/lib/api/veeam-one-client"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function startReportSession(taskId: string, parameters: any[], sessionId: string) {
    return await veeamOneClient.startReportSession(taskId, parameters, sessionId)
}

export async function getReportSessionStatus(executionId: string) {
    return await veeamOneClient.getReportSessionStatus(executionId)
}

export async function fetchReportSectionData<T>(taskId: string, sectionId: string, sessionId?: string, resourceId?: string) {
    return await veeamOneClient.getReportSectionData<T>(taskId, sectionId, sessionId, resourceId)
}
