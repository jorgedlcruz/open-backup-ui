"use client"
// Open Backup UI v1.2.0

import { useState } from "react"
import { useI18n } from "@/components/providers/i18n-provider"
import { builderDiagnostic } from "@/components/job-builder/diagnostics"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { veeamApi } from "@/lib/api/veeam-client"
import { CheckCircle2, Loader2, XCircle } from "lucide-react"

// Simple component for Entra ID jobs since they have different payloads
export function CreateEntraIdWizard() {
    const { t, formatNumber } = useI18n()
    const router = useRouter()
    const searchParams = useSearchParams()
    const type = searchParams.get('type') || 'tenant' // 'tenant' or 'audit'

    const [step, setStep] = useState(1)

    // Combined form state for both types
    const [formData, setFormData] = useState({
        name: "",
        description: "",
        tenantId: "",
        repositoryId: "", // Only needed for Audit logs
        retentionQuantity: 7,
    })

    const [isSubmitting, setIsSubmitting] = useState(false)
    const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle')
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    const handleNext = () => setStep(s => Math.min(s + 1, 3))
    const handleBack = () => setStep(s => Math.max(s - 1, 1))

    const handleSubmit = async () => {
        setIsSubmitting(true)
        setSubmitStatus('idle')
        setErrorMessage(null)

        try {
            let payload: Record<string, unknown> = {}

            if (type === 'tenant') {
                payload = {
                    name: formData.name,
                    type: "EntraIDTenantBackup",
                    description: formData.description,
                    storage: {
                        tenantId: formData.tenantId,
                        retentionPolicy: {
                            type: "RestorePoints",
                            quantity: formData.retentionQuantity
                        },
                        advancedSettings: {
                            notifications: {
                                sendSNMPNotifications: false,
                                emailNotifications: { isEnabled: false }
                            }
                        }
                    },
                    schedule: { runAutomatically: false }
                }
            } else {
                payload = {
                    name: formData.name,
                    type: "EntraIDAuditLogBackup",
                    description: formData.description,
                    isHighPriority: true,
                    tenant: {
                        tenantId: formData.tenantId
                    },
                    storage: {
                        backupRepositoryId: formData.repositoryId || "00000000-0000-0000-0000-000000000000",
                        retentionPolicy: {
                            type: "Months",
                            quantity: formData.retentionQuantity
                        },
                        advancedSettings: {
                            storageData: { compressionLevel: "Optimal", encryption: { isEnabled: false } }
                        }
                    },
                    schedule: { runAutomatically: false }
                }
            }

            const response = await veeamApi.createBackupJob(payload) as { error?: string }

            if (response && response.error) {
                throw new Error(String(response.error))
            }

            setSubmitStatus('success')
            setTimeout(() => router.push('/vbr/jobs'), 2000)

        } catch (error: unknown) {
            console.error("Job Creation Error:", error)
            setSubmitStatus('error')
            const errorMessage = error instanceof Error ? error.message : "Failed to create Entra ID backup job"
            setErrorMessage(errorMessage)
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center bg-muted/50 p-4 rounded-lg">
                {[1, 2, 3].map((s) => (
                    <div key={formatNumber(s)} className="flex items-center">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold text-sm ${step === s ? 'bg-primary text-primary-foreground' : step > s ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
                            {formatNumber(s)}
                        </div>
                        {s < 3 && <div className={`w-16 sm:w-32 h-1 mx-2 ${step > s ? 'bg-primary/30' : 'bg-muted'}`} />}
                    </div>
                ))}
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>
                        {step === 1 && t("General settings")}
                        {step === 2 && t("Storage settings")}
                        {step === 3 && t("Review plan")}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {step === 1 && (
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">{t("Job name")}<span className="text-red-500">*</span></Label>
                                <Input
                                    id="name"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder={t("e.g. Entra ID Backup")}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="description">{t("Description")}</Label>
                                <Textarea
                                    id="description"
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="tenantId">{t("Entra ID tenant ID")}<span className="text-red-500">*</span></Label>
                                <Input
                                    id="tenantId"
                                    value={formData.tenantId}
                                    onChange={(e) => setFormData({ ...formData, tenantId: e.target.value })}
                                    placeholder="a1401206-5c01-4586-aa81-573aeb027b6d"
                                />
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-4">
                            {type === 'audit' && (
                                <div className="space-y-2">
                                    <Label htmlFor="repositoryId">{t("Backup repository ID (audit logs require storage)")}<span className="text-red-500">*</span></Label>
                                    <Input
                                        id="repositoryId"
                                        value={formData.repositoryId}
                                        onChange={(e) => setFormData({ ...formData, repositoryId: e.target.value })}
                                        placeholder="88788f9e-d8f5-4eb4-bc4f-9b3f5403bcec"
                                    />
                                    <p className="text-xs text-muted-foreground">{t("For simplicity, paste the UUID of the target repository here.")}</p>
                                </div>
                            )}
                            <div className="space-y-2">
                                <Label htmlFor="retention">{t('Retention policy ({unit})', {unit:t(type === 'audit' ? 'Months' : 'Restore points')})}</Label>
                                <Input
                                    id="retention"
                                    type="number"
                                    value={formData.retentionQuantity}
                                    onChange={(e) => setFormData({ ...formData, retentionQuantity: parseInt(e.target.value) || 7 })}
                                />
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                <div className="space-y-4">
                                    <div>
                                        <span className="font-semibold block text-muted-foreground">{t("Job name")}</span>
                                        {formData.name}
                                    </div>
                                    <div>
                                        <span className="font-semibold block text-muted-foreground">{t("Tenant ID")}</span>
                                        {formData.tenantId}
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    {type === 'audit' && (
                                        <div>
                                            <span className="font-semibold block text-muted-foreground">{t("Repository ID")}</span>
                                            {formData.repositoryId || <span className="text-red-500">{t("Missing")}</span>}
                                        </div>
                                    )}
                                    <div>
                                        <span className="font-semibold block text-muted-foreground">{t("Retention")}</span>
                                        {t(type === 'audit' ? '{count} months' : '{count} restore points', {count:formatNumber(formData.retentionQuantity)})}
                                    </div>
                                </div>
                            </div>

                            {submitStatus === 'error' && (
                                <div className="p-4 bg-red-50 text-red-600 rounded-md flex items-start border border-red-200">
                                    <XCircle className="h-5 w-5 mr-2 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-medium">{t("Job creation failed")}</p>
                                        <p className="text-sm mt-1">{errorMessage === "Failed to create Entra ID backup job" ? t("Failed to create Entra ID backup job") : builderDiagnostic(t,errorMessage || "")}</p>
                                    </div>
                                </div>
                            )}

                            {submitStatus === 'success' && (
                                <div className="p-4 bg-green-50 text-green-600 rounded-md flex items-start border border-green-200">
                                    <CheckCircle2 className="h-5 w-5 mr-2 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-medium">{t("Job created successfully")}</p>
                                        <p className="text-sm mt-1">{t('The backup job “{name}” has been created.', {name:formData.name})}</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>

                <CardFooter className="flex justify-between border-t p-6">
                    {step < 3 ? (
                        <>
                            <Button variant="outline" onClick={step === 1 ? () => router.back() : handleBack}>
                                {t(step === 1 ? 'Cancel' : 'Back')}
                            </Button>
                            <Button
                                onClick={handleNext}
                                disabled={
                                    (step === 1 && (!formData.name.trim() || !formData.tenantId.trim())) ||
                                    (step === 2 && type === 'audit' && !formData.repositoryId.trim())
                                }
                            >{t("Next")}</Button>
                        </>
                    ) : (
                        <>
                            <Button variant="outline" onClick={handleBack} disabled={isSubmitting || submitStatus === 'success'}>{t("Back")}</Button>
                            <Button
                                onClick={handleSubmit}
                                disabled={isSubmitting || submitStatus === 'success'}
                            >
                                {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                {t(submitStatus === 'success' ? 'Created' : 'Create Backup Job')}
                            </Button>
                        </>
                    )}
                </CardFooter>
            </Card>
        </div>
    )
}

export function CreateEntraIdHeading({type}:{type:string}) {
    const {t}=useI18n()
    return <><h1 className="text-3xl font-bold tracking-tight">{t('Create Backup Job')}</h1><p className="text-muted-foreground mt-2">{type==='audit'?t('Configure a new Microsoft Entra ID audit log backup job.'):t('Configure a new Microsoft Entra ID tenant backup job.')}</p></>
}
