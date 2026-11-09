"use client"
// Open Backup UI v1.0.2

import { DynamicReportView } from "@/components/analytics/dynamic-report-view"

interface SectionInfo {
    sectionId: string
    status: string
}

interface DynamicReportViewClientProps {
    taskId: string
    sessionId: string
    resourceId: string
    sections: SectionInfo[]
}

export function DynamicReportViewClient(props: DynamicReportViewClientProps) {
    return <DynamicReportView {...props} />
}
