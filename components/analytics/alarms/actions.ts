"use server"

import { veeamOneClient } from "@/lib/api/veeam-one-client"
import { AlarmTemplate } from "@/lib/types/veeam-one-alarms"

export async function getAlarmDetailsAction(templateId: number | string): Promise<AlarmTemplate | null> {
    return await veeamOneClient.getAlarmTemplate(templateId);
}

export async function resolveAlarmAction(childAlarmIds: number[], comment: string): Promise<boolean> {
    return await veeamOneClient.resolveAlarms(childAlarmIds, comment);
}
