"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { veeamApi } from "@/lib/api/veeam-client"
import { VeeamBackupJob, VeeamRepository } from "@/lib/types/veeam"
import { CheckCircle2, Loader2, XCircle, HardDrive } from "lucide-react"
import { SourceJobSelector } from "./source-job-selector"

export function CreateBackupCopyWizard() {
    const router = useRouter()
    const [step, setStep] = useState(1)

    // Form state
    const [name, setName] = useState("")
    const [description, setDescription] = useState("")
    const [selectedJobs, setSelectedJobs] = useState<VeeamBackupJob[]>([])

    // Target state
    const [repositoryId, setRepositoryId] = useState("")
    const [retentionDays, setRetentionDays] = useState(7)
    const [gfsEnabled, setGfsEnabled] = useState(false)
    const [gfsWeekly, setGfsWeekly] = useState(1)
    const [gfsMonthly, setGfsMonthly] = useState(1)
    const [gfsYearly, setGfsYearly] = useState(1)

    const [repositories, setRepositories] = useState<VeeamRepository[]>([])
    const [loadingRepos, setLoadingRepos] = useState(false)

    // UI state
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isValidatingName, setIsValidatingName] = useState(false)
    const [nameError, setNameError] = useState<string | null>(null)
    const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle')
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    // Fetch repositories when component mounts
    useEffect(() => {
        const fetchRepos = async () => {
            setLoadingRepos(true)
            try {
                const repos = await veeamApi.getRepositories()
                setRepositories(repos)
                if (repos.length > 0 && !repositoryId) {
                    setRepositoryId(repos[0].id)
                }
            } catch (err) {
                console.error("Failed to fetch repositories", err)
            } finally {
                setLoadingRepos(false)
            }
        }
        fetchRepos()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const handleNext = async () => {
        if (step === 1) {
            if (!name.trim()) {
                setNameError("Job name cannot be empty")
                return
            }
            setIsValidatingName(true)
            setNameError(null)
            const isValid = await veeamApi.validateJobName(name)
            setIsValidatingName(false)
            if (!isValid) {
                setNameError("A job with this name already exists")
                return
            }
        }
        setStep(s => Math.min(s + 1, 4))
    }

    const handleBack = () => setStep(s => Math.max(s - 1, 1))

    const handleSubmit = async () => {
        setIsSubmitting(true)
        setSubmitStatus('idle')
        setErrorMessage(null)

        try {
            const payload = {
                type: "BackupCopy",
                name: name,
                description: description || "Created via Open Backup UI",
                mode: "Immediate", // Immediate mode is V12+ default
                sourceObjects: {
                    includes: {
                        jobs: selectedJobs.map(job => ({
                            name: job.name,
                            id: job.id,
                            type: job.type
                        })),
                        repositories: []
                    }
                },
                dataTransfer: {
                    wanAcceleratorSettings: {
                        transferMode: "Direct"
                    }
                },
                schedule: {
                    type: "Immediate",
                    scheduleMode: "Continuous",
                    syncRestorePoints: {
                        isEnabled: false,
                        syncInterval: "Minutes15"
                    }
                },
                target: {
                    backupRepositoryId: repositoryId,
                    retentionPolicy: {
                        type: "Days",
                        quantity: retentionDays
                    },
                    gfsPolicy: {
                        isEnabled: gfsEnabled,
                        weekly: {
                            isEnabled: gfsEnabled && gfsWeekly > 0,
                            keepForNumberOfWeeks: gfsWeekly,
                            desiredTime: "Sunday"
                        },
                        monthly: {
                            isEnabled: gfsEnabled && gfsMonthly > 0,
                            keepForNumberOfMonths: gfsMonthly,
                            desiredTime: "First"
                        },
                        yearly: {
                            isEnabled: gfsEnabled && gfsYearly > 0,
                            keepForNumberOfYears: gfsYearly,
                            desiredTime: "January"
                        }
                    }
                }
            }

            const response = await veeamApi.createBackupJob(payload) as { error?: string, id?: string }

            if (response && response.error) {
                throw new Error(String(response.error))
            }

            // Enable the job after creation, as requested in the flow
            if (response.id) {
                try {
                    await veeamApi.enableJob(response.id)
                } catch (enableErr) {
                    console.error("Job created but failed to enable it automatically.", enableErr)
                    // We can still proceed to success since it's created
                }
            }

            setSubmitStatus('success')
            setTimeout(() => router.push('/vbr/jobs'), 2000)

        } catch (error: unknown) {
            console.error("Job Creation Error:", error)
            setSubmitStatus('error')
            const errorMessage = error instanceof Error ? error.message : "Failed to create Backup Copy Job"
            setErrorMessage(errorMessage)
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="space-y-6">
            {/* Step Indicators */}
            <div className="flex justify-between items-center bg-muted/50 p-4 rounded-lg overflow-x-auto">
                {['Name', 'Objects', 'Target', 'Summary'].map((label, index) => {
                    const s = index + 1;
                    return (
                        <div key={s} className="flex items-center">
                            <div className={`flex flex-col items-center mx-2 sm:mx-4`}>
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold text-sm mb-1 ${step === s ? 'bg-primary text-primary-foreground' : step > s ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
                                    {s}
                                </div>
                                <span className="text-xs font-medium text-muted-foreground hidden sm:block">{label}</span>
                            </div>
                            {s < 4 && <div className={`w-8 sm:w-16 h-1 mt-[-20px] ${step > s ? 'bg-primary/30' : 'bg-muted'}`} />}
                        </div>
                    )
                })}
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>
                        {step === 1 && "General Settings"}
                        {step === 2 && "Source Backup Jobs"}
                        {step === 3 && "Target Repository & Retention"}
                        {step === 4 && "Review & Complete"}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {step === 1 && (
                        <div className="space-y-4 max-w-xl">
                            <div className="space-y-2">
                                <Label htmlFor="name">Job Name <span className="text-red-500">*</span></Label>
                                <Input
                                    id="name"
                                    value={name}
                                    onChange={(e) => {
                                        setName(e.target.value)
                                        if (nameError) setNameError(null)
                                    }}
                                    placeholder="e.g. Backup Copy to Offsite"
                                />
                                {nameError && <p className="text-sm text-red-500 mt-1">{nameError}</p>}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="description">Description</Label>
                                <Textarea
                                    id="description"
                                    rows={4}
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Optional description"
                                />
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <SourceJobSelector
                            selectedJobs={selectedJobs}
                            onSelectionChange={setSelectedJobs}
                        />
                    )}

                    {step === 3 && (
                        <div className="space-y-8 max-w-2xl">
                            <div className="space-y-4">
                                <h3 className="text-lg font-medium border-b pb-2">Target Repository</h3>
                                <div className="space-y-2">
                                    <Label htmlFor="repository" className="flex items-center">
                                        <HardDrive className="h-4 w-4 mr-2" />
                                        Backup Repository <span className="text-red-500 ml-1">*</span>
                                    </Label>
                                    {loadingRepos ? (
                                        <div className="flex items-center h-10 px-3 border rounded-md bg-muted/50 text-muted-foreground">
                                            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading repositories...
                                        </div>
                                    ) : (
                                        <Select value={repositoryId} onValueChange={setRepositoryId}>
                                            <SelectTrigger id="repository">
                                                <SelectValue placeholder="Select Backup Repository" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {repositories.map(repo => (
                                                    <SelectItem key={repo.id} value={repo.id}>
                                                        {repo.name} ({repo.type})
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h3 className="text-lg font-medium border-b pb-2">Retention Policy</h3>
                                <div className="space-y-2 max-w-xs">
                                    <Label htmlFor="retentionDays">Restore points to keep (Days) <span className="text-red-500 ml-1">*</span></Label>
                                    <Input
                                        id="retentionDays"
                                        type="number"
                                        min={1}
                                        max={999}
                                        value={retentionDays}
                                        onChange={(e) => setRetentionDays(parseInt(e.target.value) || 7)}
                                    />
                                </div>

                                <div className="space-y-4 pt-4">
                                    <div className="flex flex-col space-y-4 p-4 border rounded-md bg-card">
                                        <div className="flex items-center justify-between">
                                            <div className="space-y-0.5">
                                                <Label className="text-base font-semibold">Keep certain full backups longer for archival purposes (GFS)</Label>
                                                <p className="text-sm text-muted-foreground">Enable Grandfather-Father-Son retention policy</p>
                                            </div>
                                            <Switch
                                                checked={gfsEnabled}
                                                onCheckedChange={setGfsEnabled}
                                            />
                                        </div>

                                        {gfsEnabled && (
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t">
                                                <div className="space-y-2">
                                                    <Label htmlFor="gfsWeekly">Weekly fulls</Label>
                                                    <Input
                                                        id="gfsWeekly"
                                                        type="number"
                                                        min={0}
                                                        disabled={!gfsEnabled}
                                                        value={gfsWeekly}
                                                        onChange={(e) => setGfsWeekly(parseInt(e.target.value) || 0)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="gfsMonthly">Monthly fulls</Label>
                                                    <Input
                                                        id="gfsMonthly"
                                                        type="number"
                                                        min={0}
                                                        disabled={!gfsEnabled}
                                                        value={gfsMonthly}
                                                        onChange={(e) => setGfsMonthly(parseInt(e.target.value) || 0)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="gfsYearly">Yearly fulls</Label>
                                                    <Input
                                                        id="gfsYearly"
                                                        type="number"
                                                        min={0}
                                                        disabled={!gfsEnabled}
                                                        value={gfsYearly}
                                                        onChange={(e) => setGfsYearly(parseInt(e.target.value) || 0)}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 4 && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 bg-muted/30 rounded-lg text-sm border">
                                <div className="space-y-4">
                                    <div>
                                        <span className="font-semibold block text-muted-foreground mb-1">Job Name</span>
                                        <div className="font-medium text-base">{name}</div>
                                    </div>
                                    <div>
                                        <span className="font-semibold block text-muted-foreground mb-1">Description</span>
                                        <div>{description || <span className="text-muted-foreground italic">None</span>}</div>
                                    </div>
                                    <div>
                                        <span className="font-semibold block text-muted-foreground mb-1">Source Objects</span>
                                        <div>{selectedJobs.length} backup jobs selected</div>
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <div>
                                        <span className="font-semibold block text-muted-foreground mb-1">Target Repository</span>
                                        <div>{repositories.find(r => r.id === repositoryId)?.name || repositoryId || <span className="text-red-500">Not selected</span>}</div>
                                    </div>
                                    <div>
                                        <span className="font-semibold block text-muted-foreground mb-1">Retention</span>
                                        <div>{retentionDays} days</div>
                                    </div>
                                    <div>
                                        <span className="font-semibold block text-muted-foreground mb-1">GFS Retention</span>
                                        <div>
                                            {gfsEnabled
                                                ? `${gfsWeekly} weekly, ${gfsMonthly} monthly, ${gfsYearly} yearly`
                                                : "Disabled"}
                                        </div>
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
                                        <p className="text-sm mt-1">The backup copy job &apos;{name}&apos; has been created and enabled.</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>

                <CardFooter className="flex justify-between border-t p-6">
                    {step === 1 ? (
                        <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
                    ) : (
                        <Button variant="outline" onClick={handleBack} disabled={isSubmitting || submitStatus === 'success'}>Back</Button>
                    )}

                    {step < 4 ? (
                        <Button
                            onClick={handleNext}
                            disabled={
                                isValidatingName ||
                                (step === 1 && !name.trim()) ||
                                (step === 2 && selectedJobs.length === 0) ||
                                (step === 3 && !repositoryId)
                            }
                        >
                            {isValidatingName && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Next
                        </Button>
                    ) : (
                        <Button
                            onClick={handleSubmit}
                            disabled={isSubmitting || submitStatus === 'success'}
                            className="bg-green-600 hover:bg-green-700"
                        >
                            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            {submitStatus === 'success' ? 'Created and Enabled' : 'Finish & Create'}
                        </Button>
                    )}
                </CardFooter>
            </Card>
        </div>
    )
}
