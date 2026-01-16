import { veeamOneClient } from "@/lib/api/veeam-one-client"
import { Button } from "@/components/ui/button"
import { ArrowLeft, ExternalLink, AlertTriangle } from "lucide-react"
import Link from "next/link"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { DynamicReportViewClient } from "./client"

interface ReportPageProps {
    params: Promise<{
        id: string
    }>
}

export const dynamic = 'force-dynamic'

// Helper: Poll for report completion and return resourceId + sections
interface ReportSessionResult {
    resourceId: string
    sections: { sectionId: string; status: string }[]
}

async function waitForReportReady(executionId: string): Promise<ReportSessionResult | null> {
    console.log(`[ReportPage] Polling for report completion, executionId: ${executionId}`);

    for (let i = 0; i < 30; i++) {
        const status = await veeamOneClient.getReportSessionStatus(executionId);
        console.log(`[ReportPage] Poll ${i + 1}/30, state: ${status?.state}, hasResourceId: ${!!status?.result?.data?.resourceId}`);

        // Data is available when resourceId is present, even while state is still "Running"
        if (status?.result?.data?.resourceId) {
            console.log(`[ReportPage] Report ready! resourceId: ${status.result.data.resourceId}`);
            console.log(`[ReportPage] Sections:`, status.result.data.sections);
            return {
                resourceId: status.result.data.resourceId,
                sections: status.result.data.sections as { sectionId: string; status: string }[]
            };
        }
        if (status?.state === "Failed") {
            console.error("[ReportPage] Report generation failed:", status);
            return null;
        }
        await new Promise(r => setTimeout(r, 500));
    }
    console.error("[ReportPage] Report generation timed out after 30 polls");
    return null;
}

export default async function ReportDetailsPage({ params }: ReportPageProps) {
    const { id: taskId } = await params

    // Check if Veeam ONE is configured
    if (!veeamOneClient.isConfigured()) {
        return (
            <div className="container mx-auto py-8 px-4 flex flex-col h-full space-y-6">
                <div className="flex items-center gap-4">
                    <Link href="/analytics/reports">
                        <Button variant="outline" size="icon">
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    </Link>
                    <h2 className="text-2xl font-bold tracking-tight">Report Details</h2>
                </div>
                <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Veeam ONE Not Configured</AlertTitle>
                    <AlertDescription>
                        To use analytics and reporting features, please configure the VEEAM_ONE_API_URL,
                        VEEAM_ONE_USERNAME, and VEEAM_ONE_PASSWORD environment variables.
                    </AlertDescription>
                </Alert>
            </div>
        )
    }

    // Get template info
    const template = await veeamOneClient.getReportTemplate(taskId);

    // Check if this report has web preview capability
    if (!template?.hasWebPreview) {
        // Get native preview link for non-webpreview reports
        const previewLink = template ? await veeamOneClient.getReportPreviewLink(template.reportTemplateId) : null;

        return (
            <div className="container mx-auto py-8 px-4 flex flex-col h-full space-y-6">
                <div className="flex items-center gap-4">
                    <Link href="/analytics/reports">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    </Link>
                    <div>
                        <h2 className="text-2xl font-bold tracking-tight">{template?.name || 'Report Details'}</h2>
                        <p className="text-muted-foreground text-sm">{template?.description || taskId}</p>
                    </div>
                </div>

                <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Web Preview Not Available</AlertTitle>
                    <AlertDescription className="space-y-4">
                        <p>
                            This report does not support embedded web preview. You can view it in the native Veeam ONE Reporter interface.
                        </p>
                        {previewLink && (
                            <a
                                href={previewLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 text-primary hover:underline"
                            >
                                Open in Veeam ONE <ExternalLink className="h-4 w-4" />
                            </a>
                        )}
                    </AlertDescription>
                </Alert>
            </div>
        );
    }

    // Start report session
    console.log(`[ReportPage] Starting webview session...`);
    const sessionId = await veeamOneClient.startWebviewSession();
    console.log(`[ReportPage] Got sessionId: ${sessionId}`);

    console.log(`[ReportPage] Starting report session for taskId: ${taskId}`);
    const startResult = await veeamOneClient.startReportSession(taskId, [], sessionId);
    console.log(`[ReportPage] Start result:`, startResult);
    if (!startResult) {
        return (
            <div className="container mx-auto py-8 px-4">
                <h1 className="text-2xl font-bold text-red-500">Failed to start report session</h1>
                <p className="text-muted-foreground mt-2">Please try again later.</p>
            </div>
        );
    }

    // Wait for report to complete - this returns the sections list!
    const reportResult = await waitForReportReady(startResult.id);
    if (!reportResult) {
        return (
            <div className="container mx-auto py-8 px-4">
                <h1 className="text-2xl font-bold text-red-500">Failed to generate report</h1>
                <p className="text-muted-foreground mt-2">The report timed out or failed while generating.</p>
            </div>
        );
    }

    const { resourceId, sections } = reportResult;

    return (
        <div className="container mx-auto py-8 px-4 flex flex-col h-full space-y-6">
            <div className="flex items-center gap-4">
                <Link href="/analytics/reports">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                </Link>
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">{template?.name}</h2>
                    <p className="text-muted-foreground text-sm max-w-3xl line-clamp-2">
                        {template?.description}
                    </p>
                </div>
            </div>

            <DynamicReportViewClient
                taskId={taskId}
                sessionId={sessionId}
                resourceId={resourceId}
                sections={sections}
            />
        </div>
    )
}
