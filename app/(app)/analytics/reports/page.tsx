import { veeamOneClient } from "@/lib/api/veeam-one-client"
import { ReportCatalog } from "@/components/analytics/report-catalog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"

export const dynamic = 'force-dynamic'

export default async function ReportCatalogPage() {
    // Check if Veeam ONE is configured
    if (!veeamOneClient.isConfigured()) {
        return (
            <div className="container mx-auto py-8 px-4 flex flex-col h-full space-y-6">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Report Catalog</h2>
                    <p className="text-muted-foreground">
                        Browse and generate reports from the library of available templates.
                    </p>
                </div>
                <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Veeam ONE Not Configured</AlertTitle>
                    <AlertDescription>
                        To use analytics and reporting features, please configure the VEEAM_ONE_API_URL,
                        VEEAM_ONE_USERNAME, and VEEAM_ONE_PASSWORD environment variables.
                    </AlertDescription>
                </Alert>
            </div>
        )
    }

    // Fetch templates first (triggers auth), then tags to avoid race condition
    const templates = await veeamOneClient.getReportTemplates()
    const tags = await veeamOneClient.getReportTags()

    return (
        <div className="container mx-auto py-8 px-4 flex flex-col h-full space-y-6">
            <div>
                <h2 className="text-2xl font-bold tracking-tight">Report Catalog</h2>
                <p className="text-muted-foreground">
                    Browse and generate reports from the library of available templates.
                </p>
            </div>
            <div className="flex-1">
                <ReportCatalog templates={templates} tags={tags} />
            </div>
        </div>
    )
}
