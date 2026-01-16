import { veeamOneClient } from "@/lib/api/veeam-one-client"
import { SavedReportsBrowser } from "@/components/analytics/saved-reports-browser"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"

export const dynamic = 'force-dynamic'

export default async function SavedReportsPage() {
    // Check if Veeam ONE is configured
    if (!veeamOneClient.isConfigured()) {
        return (
            <div className="container mx-auto py-8 px-4 flex flex-col h-full space-y-6">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Saved Reports</h2>
                    <p className="text-muted-foreground">
                        View your organized collection of generated reports.
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

    const reports = await veeamOneClient.getSavedReports()

    return (
        <div className="container mx-auto py-8 px-4 flex flex-col h-full space-y-6">
            <div>
                <h2 className="text-2xl font-bold tracking-tight">Saved Reports</h2>
                <p className="text-muted-foreground">
                    View your organized collection of generated reports.
                </p>
            </div>
            <div className="flex-1">
                <SavedReportsBrowser items={reports} />
            </div>
        </div>
    )
}
