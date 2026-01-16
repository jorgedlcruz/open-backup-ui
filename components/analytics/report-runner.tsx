"use client"

import { useState, useEffect } from "react"
import { startReportSession, getReportSessionStatus } from "@/app/(app)/analytics/actions"
import { Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { v4 as uuidv4 } from 'uuid'
import { useRouter, usePathname, useSearchParams } from "next/navigation"

interface ReportRunnerProps {
    taskId: string
    reportName: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    defaultParameters?: any[]
}

export function ReportRunner({ taskId, reportName, defaultParameters = [] }: ReportRunnerProps) {
    const [status, setStatus] = useState<"idle" | "starting" | "polling" | "ready" | "error">("idle")
    const [error, setError] = useState<string>("")
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()

    useEffect(() => {
        // If we already have params, do nothing (we are likely unmounting or already redirected)
        if (searchParams.get("sessionId") && searchParams.get("resourceId")) {
            return
        }

        let isMounted = true
        let pollInterval: NodeJS.Timeout | null = null

        const runReport = async () => {
            try {
                if (status !== "idle") return

                setStatus("starting")

                // 1. Generate new Session ID
                const newSessionId = uuidv4()
                console.log("[ReportRunner] Starting session:", newSessionId)

                // 2. Start Report Session
                const startResult = await startReportSession(taskId, defaultParameters, newSessionId)

                if (!startResult || !startResult.id) {
                    throw new Error("Failed to start report session")
                }

                const executionId = startResult.id
                setStatus("polling")

                // 3. Poll for Status
                const checkStatus = async () => {
                    const statusResult = await getReportSessionStatus(executionId)
                    console.log("[ReportRunner] Poll status:", statusResult?.state)

                    if (!statusResult) return // Network glitch? retry next tick

                    if (statusResult.state === "Completed" && statusResult.result?.data?.resourceId) {
                        if (isMounted) {
                            setStatus("ready")
                            if (pollInterval) clearInterval(pollInterval)
                            const params = new URLSearchParams(searchParams)
                            params.set("sessionId", newSessionId)
                            params.set("resourceId", statusResult.result.data.resourceId)
                            const newUrl = `${pathname}?${params.toString()}`;
                            console.log("[ReportRunner] Redirecting to:", newUrl);
                            router.replace(newUrl);
                        }
                    } else if (statusResult.state === "Failed") {
                        throw new Error("Report generation failed on server")
                    }
                }

                await checkStatus()
                pollInterval = setInterval(checkStatus, 1000)

            } catch (err) {
                if (isMounted) {
                    console.error(err)
                    setError(err instanceof Error ? err.message : "Unknown error")
                    setStatus("error")
                    if (pollInterval) clearInterval(pollInterval)
                }
            }
        }

        runReport()

        return () => {
            isMounted = false
        }
    }, [taskId, status, router, pathname, searchParams, defaultParameters])

    if (status === "error") {
        return (
            <Card className="w-full h-96 flex items-center justify-center border-destructive/50 bg-destructive/5">
                <CardContent className="text-center">
                    <h3 className="text-lg font-semibold text-destructive mb-2">Failed to generate report</h3>
                    <p className="text-muted-foreground">{error}</p>
                    <button onClick={() => window.location.reload()} className="mt-4 underline hover:no-underline">
                        Retry
                    </button>
                </CardContent>
            </Card>
        )
    }

    return (
        <div className="w-full h-[600px] flex flex-col items-center justify-center space-y-4 bg-muted/5 rounded-xl border-2 border-dashed">
            <div className="flex items-center space-x-3 text-primary">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-xl font-medium">Generating {reportName}...</span>
            </div>
            <div className="text-sm text-muted-foreground max-w-md text-center">
                {status === "starting" && "Initializing report session..."}
                {status === "polling" && "Waiting for Veeam ONE to process data..."}
                {status === "ready" && "Finalizing..."}
            </div>
        </div>
    )
}
