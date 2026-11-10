"use client"
// Open Backup UI v1.2.0

import { VeeamBackupJob } from "@/lib/types/veeam"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PlayCircle, StopCircle, RefreshCw, PowerOff, Power, ChevronLeft } from "lucide-react"
import Link from "next/link"
import { veeamApi } from "@/lib/api/veeam-client"
import { toast } from "sonner"

interface JobDetailsHeaderProps {
    job: VeeamBackupJob
    onRefresh?: () => void
}

export function JobDetailsHeader({ job, onRefresh }: JobDetailsHeaderProps) {

    const handleAction = async (action: 'start' | 'stop' | 'retry' | 'disable' | 'enable') => {
        try {
            switch (action) {
                case 'start':
                    await veeamApi.startJob(job.id);
                    toast.success('Job started successfully');
                    break;
                case 'stop':
                    await veeamApi.stopJob(job.id);
                    toast.success('Job stopped successfully');
                    break;
                case 'retry':
                    await veeamApi.retryJob(job.id);
                    toast.success('Job retry initiated successfully');
                    break;
                case 'disable':
                    await veeamApi.disableJob(job.id);
                    toast.success('Job disabled successfully');
                    break;
                case 'enable':
                    await veeamApi.enableJob(job.id);
                    toast.success('Job enabled successfully');
                    break;
            }
            if (onRefresh) onRefresh();
        } catch (error) {
            console.error(`Error performing ${action}:`, error);
            toast.error(`Failed to ${action} job`);
        }
    };

    return (
        <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0">
            <div className="flex items-center space-x-4">
                <Button variant="outline" size="icon" asChild>
                    <Link href="/vbr/jobs">
                        <ChevronLeft className="h-4 w-4" />
                    </Link>
                </Button>
                <div>
                    <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        {job.name}
                        <Badge variant="outline" className="ml-2 font-normal">
                            {job.type}
                        </Badge>
                    </h2>
                    <p className="text-muted-foreground">
                        {job.description || "No description provided"}
                    </p>
                </div>
            </div>

            <div className="flex items-center space-x-2">
                <Button size="sm" onClick={() => handleAction('start')}>
                    <PlayCircle className="mr-2 h-4 w-4" /> Start
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleAction('stop')}>
                    <StopCircle className="mr-2 h-4 w-4" /> Stop
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleAction('retry')}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Retry
                </Button>
                {job.isDisabled ? (
                    <Button size="sm" variant="secondary" onClick={() => handleAction('enable')}>
                        <Power className="mr-2 h-4 w-4" /> Enable
                    </Button>
                ) : (
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleAction('disable')}>
                        <PowerOff className="mr-2 h-4 w-4" /> Disable
                    </Button>
                )}
            </div>
        </div>
    )
}
