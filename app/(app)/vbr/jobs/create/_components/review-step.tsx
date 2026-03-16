import { useState } from "react"
import { veeamApi } from "@/lib/api/veeam-client"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle2, XCircle } from "lucide-react"
import { StorageConfig } from "./storage-selector"
import { ScheduleConfig } from "./schedule-selector"
import { VeeamInventoryItem } from "@/lib/types/veeam"

interface ReviewStepProps {
    platform?: string
    formData: {
        name: string;
        description: string;
        selectedVMs: VeeamInventoryItem[];
        storage: StorageConfig;
        schedule: ScheduleConfig;
    }
    onSuccess: () => void
}

export function ReviewStep({ platform, formData, onSuccess }: ReviewStepProps) {
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle')
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    const handleSubmit = async () => {
        setIsSubmitting(true)
        setSubmitStatus('idle')
        setErrorMessage(null)

        try {
            const isHyperV = platform === 'hyperv'
            const payload = {
                name: formData.name,
                description: formData.description,
                type: isHyperV ? "HyperVBackup" : "VSphereBackup",
                isHighPriority: false,
                virtualMachines: {
                    includes: formData.selectedVMs.map(vm => ({
                        type: vm.type,
                        hostName: vm.hostName,
                        name: vm.name,
                        objectId: vm.objectId,
                        platform: vm.platform || (isHyperV ? "HyperV" : "Vmware")
                    }))
                },
                storage: {
                    backupRepositoryId: formData.storage.repositoryId,
                    backupProxies: {
                        automaticSelection: formData.storage.proxyId === 'auto',
                        selectedProxyIds: formData.storage.proxyId !== 'auto' ? [formData.storage.proxyId] : []
                    },
                    retentionPolicy: {
                        type: "Days",
                        quantity: formData.storage.retentionDays
                    },
                    advancedSettings: {
                        backupModeType: formData.storage.activeFullsEnabled ? "ReverseIncremental" : "Incremental",
                        syntheticFulls: {
                            isEnabled: formData.storage.syntheticFullsEnabled,
                            weeklySchedule: {
                                days: formData.storage.syntheticFullsDays
                            }
                        },
                        activeFulls: {
                            isEnabled: formData.storage.activeFullsEnabled,
                            weeklySchedule: {
                                days: formData.storage.activeFullsDays
                            }
                        },
                        storageOptimization: "LocalTarget",
                        ...(isHyperV ? {
                            hyperV: {
                                guestQuiescence: { isEnabled: false, crashConsistentBackup: false },
                                changedBlockTracking: true,
                                volumeSnapshots: true
                            }
                        } : {})
                    }
                },
                guestProcessing: {
                    appAwareProcessing: {
                        isEnabled: formData.schedule.applicationAwareProcessing
                    },
                    guestFSIndexing: {
                        isEnabled: false
                    }
                },
                schedule: {
                    runAutomatically: formData.schedule.enableSchedule,
                    daily: formData.schedule.enableSchedule ? {
                        type: formData.schedule.dailyType,
                        times: [formData.schedule.dailyTime]
                    } : undefined
                }
            }

            const response = await veeamApi.createBackupJob(payload) as { error?: string }

            if (response && response.error) {
                throw new Error(String(response.error))
            }

            setSubmitStatus('success')
            onSuccess() // Callback to maybe redirect or show success UI

        } catch (error: unknown) {
            console.error("Job Creation Error:", error)
            setSubmitStatus('error')
            const err = error as { message?: string }
            setErrorMessage(err.message || "Failed to create backup job")
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="space-y-6">
            <h3 className="text-lg font-medium border-b pb-2">Review Summary</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="space-y-4">
                    <div>
                        <span className="font-semibold block text-muted-foreground">Job Name</span>
                        {formData.name}
                    </div>
                    <div>
                        <span className="font-semibold block text-muted-foreground">Description</span>
                        {formData.description || <span className="italic text-muted-foreground">None</span>}
                    </div>
                    <div>
                        <span className="font-semibold block text-muted-foreground">Virtual Machines ({formData.selectedVMs.length})</span>
                        <ul className="list-disc pl-5 mt-1 text-muted-foreground">
                            {formData.selectedVMs.slice(0, 3).map(vm => (
                                <li key={vm.objectId}>{vm.name}</li>
                            ))}
                            {formData.selectedVMs.length > 3 && (
                                <li>...and {formData.selectedVMs.length - 3} more</li>
                            )}
                            {formData.selectedVMs.length === 0 && (
                                <li className="text-red-500 font-medium list-none -ml-5">Warning: No VMs selected</li>
                            )}
                        </ul>
                    </div>
                </div>

                <div className="space-y-4">
                    <div>
                        <span className="font-semibold block text-muted-foreground">Storage</span>
                        <div>Repository: {formData.storage.repositoryId ? "Configured" : <span className="text-red-500 font-medium">Missing</span>}</div>
                        <div>Proxy: {formData.storage.proxyId === 'auto' ? "Automatic" : "Specific Selection"}</div>
                        <div>Retention: {formData.storage.retentionDays} Days</div>
                    </div>
                    <div>
                        <span className="font-semibold block text-muted-foreground">Schedule</span>
                        <div>Enabled: {formData.schedule.enableSchedule ? "Yes" : "No"}</div>
                        {formData.schedule.enableSchedule && (
                            <div>Runs {formData.schedule.dailyType} at {formData.schedule.dailyTime}</div>
                        )}
                        <div>App-Aware Processing: {formData.schedule.applicationAwareProcessing ? "Yes" : "No"}</div>
                    </div>
                </div>
            </div>

            {submitStatus === 'error' && (
                <div className="p-4 bg-red-50 text-red-600 rounded-md flex items-start border border-red-200">
                    <XCircle className="h-5 w-5 mr-2 shrink-0 mt-0.5" />
                    <div>
                        <p className="font-medium">Job Creation Failed</p>
                        <p className="text-sm mt-1">{errorMessage}</p>
                    </div>
                </div>
            )}

            {submitStatus === 'success' && (
                <div className="p-4 bg-green-50 text-green-600 rounded-md flex items-start border border-green-200">
                    <CheckCircle2 className="h-5 w-5 mr-2 shrink-0 mt-0.5" />
                    <div>
                        <p className="font-medium">Job Created Successfully</p>
                        <p className="text-sm mt-1">The backup job &apos;{formData.name}&apos; has been created and will appear in the console shortly.</p>
                    </div>
                </div>
            )}

            <div className="flex justify-end pt-4 border-t">
                <Button
                    onClick={handleSubmit}
                    disabled={isSubmitting || submitStatus === 'success' || !formData.name || formData.selectedVMs.length === 0 || !formData.storage.repositoryId}
                    className="w-full sm:w-auto"
                >
                    {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {submitStatus === 'success' ? 'Job Created' : 'Create Job'}
                </Button>
            </div>
        </div>
    )
}
