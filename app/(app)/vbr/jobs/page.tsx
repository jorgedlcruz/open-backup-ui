"use client"
// Open Backup UI v1.0.2

import { useI18n } from '@/components/providers/i18n-provider'
import { builderDiagnostic } from '@/components/job-builder/diagnostics'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from "react"
import { BackupJobsTable } from "./_components/backup-jobs-table"
import { veeamApi } from "@/lib/api/veeam-client"
import { VeeamBackupJob } from "@/lib/types/veeam"
import Link from 'next/link'
import { ArrowUpRight,RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import ops from '@/components/operations/operations.module.css'

export default function VBRJobsPage() {
  const { t } = useI18n()
    const [jobs, setJobs] = useState<VeeamBackupJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null)

    const fetchJobs = useCallback(async () => {
        try {
            setLoading(true)
            setError(null)
            const data = await veeamApi.getBackupJobs()
            setJobs(data)
        } catch (err) {
            console.error('Failed to fetch backup jobs:', err)
            setError(err instanceof Error ? err.message : 'Failed to fetch backup jobs')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchJobs()

        // Refresh data every minute.
        const interval = setInterval(fetchJobs, 60000)
        return () => clearInterval(interval)
    }, [fetchJobs])

    return (
        <div className="flex-1 overflow-auto">
            <main className={ops.console}>
                <header className={ops.header}>
                    <div>
                        <h1>{t("Jobs & policies")}</h1>
                        <p>{t("Manage protection. Open a job to investigate its runs, workloads and logs.")}</p>
                    </div>
                    <div className={ops.headerControls}><Button asChild variant="outline" size="sm"><Link href="/vbr/lens/operations">{t("Operations queue")}<ArrowUpRight size={14} /></Link></Button><Button variant="outline" size="sm" disabled={loading} onClick={fetchJobs}><RefreshCw size={14} className={loading?'animate-spin':''}/>{t("Refresh")}</Button></div>
                </header>

                {error && (
                    <div className={ops.notice} role="alert">
                        <p>{t('Error: {error}',{error:builderDiagnostic(t,error)})}</p>
                        <p>{t("Please check your API configuration and credentials")}</p>
                    </div>
                )}

                <BackupJobsTable
                    data={jobs}
                    loading={loading}
                    error={error}
                    onRefresh={fetchJobs}
                />
            </main>
        </div>
    )
}
