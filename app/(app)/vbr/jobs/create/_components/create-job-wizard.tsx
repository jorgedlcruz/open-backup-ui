"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import { VirtualMachineSelector } from "./virtual-machine-selector"
import { StorageSelector, StorageConfig } from "./storage-selector"
import { ScheduleSelector, ScheduleConfig } from "./schedule-selector"
import { ReviewStep } from "./review-step"
import { VeeamInventoryItem } from "@/lib/types/veeam"

export function CreateJobWizard() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const platform = searchParams.get('platform') || 'vmware'

    const [step, setStep] = useState(1)
    const [formData, setFormData] = useState<{
        name: string;
        description: string;
        selectedVMs: VeeamInventoryItem[];
        storage: StorageConfig;
        schedule: ScheduleConfig;
    }>({
        name: "",
        description: "Created via Open Backup UI",
        selectedVMs: [],
        storage: {
            repositoryId: "",
            proxyId: "auto",
            retentionDays: 7,
            syntheticFullsEnabled: true,
            syntheticFullsDays: ["saturday"],
            activeFullsEnabled: false,
            activeFullsDays: []
        },
        schedule: {
            applicationAwareProcessing: false,
            guestOsCredentialsId: "",
            enableSchedule: true,
            dailyTime: "22:00",
            dailyType: "Everyday"
        }
    })

    const handleNext = () => setStep(s => Math.min(s + 1, 5))
    const handleBack = () => setStep(s => Math.max(s - 1, 1))

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center bg-muted/50 p-4 rounded-lg">
                {[1, 2, 3, 4, 5].map((s) => (
                    <div key={s} className="flex items-center">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold text-sm ${step === s ? 'bg-primary text-primary-foreground' : step > s ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
                            {s}
                        </div>
                        {s < 5 && <div className={`w-12 sm:w-24 h-1 mx-2 ${step > s ? 'bg-primary/30' : 'bg-muted'}`} />}
                    </div>
                ))}
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>
                        {step === 1 && "General Settings"}
                        {step === 2 && "Virtual Machines"}
                        {step === 3 && "Storage"}
                        {step === 4 && "Guest Processing & Schedule"}
                        {step === 5 && "Review & Submit"}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {step === 1 && (
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">Job Name <span className="text-red-500">*</span></Label>
                                <Input
                                    id="name"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="e.g. Backup Job 1"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="description">Description</Label>
                                <Textarea
                                    id="description"
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    placeholder="Optional description"
                                />
                            </div>
                        </div>
                    )}
                    {step === 2 && (
                        <VirtualMachineSelector
                            platform={platform}
                            selectedVMs={formData.selectedVMs}
                            onSelectionChange={(vms) => setFormData({ ...formData, selectedVMs: vms })}
                        />
                    )}
                    {step === 3 && (
                        <StorageSelector
                            value={formData.storage}
                            onChange={(config) => setFormData({ ...formData, storage: config })}
                        />
                    )}
                    {step === 4 && (
                        <ScheduleSelector
                            value={formData.schedule}
                            onChange={(config) => setFormData({ ...formData, schedule: config })}
                        />
                    )}
                    {step === 5 && (
                        <ReviewStep
                            platform={platform}
                            formData={formData}
                            onSuccess={() => setTimeout(() => router.push('/vbr/jobs'), 2000)}
                        />
                    )}
                </CardContent>
                {step < 5 && (
                    <CardFooter className="flex justify-between border-t p-6">
                        <Button variant="outline" onClick={step === 1 ? () => router.back() : handleBack}>
                            {step === 1 ? 'Cancel' : 'Back'}
                        </Button>
                        <Button
                            onClick={handleNext}
                            disabled={step === 1 && !formData.name.trim()}
                        >
                            Next
                        </Button>
                    </CardFooter>
                )}
            </Card>
        </div>
    )
}
