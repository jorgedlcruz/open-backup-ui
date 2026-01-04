"use client"

import { useState, useEffect } from "react"
import { veeamApi } from "@/lib/api/veeam-client"
import { LicenseModel, LicenseWorkload, LicenseReport } from "@/lib/types/veeam"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import {
    Loader2,
    Trash2,
    RefreshCw,
    Download,
    Upload,
    FileText,
    Server,
    Monitor,
    HardDrive,
    Database,
    Cloud,
    CheckCircle2,
    AlertTriangle,
    XCircle,
    Calendar,
    LayoutDashboard,
    UserRoundCog,
    FolderClosed,
    MonitorDot
} from "lucide-react"
import { toast } from "sonner"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Progress } from "@/components/ui/progress"

export default function LicensingPage() {
    const [license, setLicense] = useState<LicenseModel | null>(null)
    const [loading, setLoading] = useState(true)
    const [revokingId, setRevokingId] = useState<string | null>(null)
    const [generatingReport, setGeneratingReport] = useState(false)

    // Revoke Dialog State
    const [isRevokeDialogOpen, setIsRevokeDialogOpen] = useState(false)
    const [workloadToRevoke, setWorkloadToRevoke] = useState<LicenseWorkload | null>(null)

    const fetchLicense = async () => {
        try {
            setLoading(true)
            const data = await veeamApi.getLicenseInfo()
            setLicense(data)
        } catch (error) {
            toast.error("Failed to load license info")
            console.error(error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchLicense()
    }, [])

    const handleRevokeClick = (workload: LicenseWorkload) => {
        setWorkloadToRevoke(workload)
        setIsRevokeDialogOpen(true)
    }

    const confirmRevoke = async () => {
        if (!workloadToRevoke) return

        try {
            setRevokingId(workloadToRevoke.instanceId)
            // Determine revocation type
            if (workloadToRevoke.platformType === 'UnstructuredData') {
                await veeamApi.revokeLicenseCapacity(workloadToRevoke.instanceId)
            } else {
                await veeamApi.revokeLicenseInstance(workloadToRevoke.instanceId)
            }

            toast.success(`License revoked for ${workloadToRevoke.name}`)
            // Refresh list
            await fetchLicense()
        } catch (error) {
            toast.error(`Failed to revoke license: ${error instanceof Error ? error.message : 'Unknown error'}`)
        } finally {
            setRevokingId(null)
            setIsRevokeDialogOpen(false)
            setWorkloadToRevoke(null)
        }
    }

    const handleCreateReport = async () => {
        try {
            setGeneratingReport(true)
            const htmlContent = await veeamApi.createLicenseReport()
            downloadReport(htmlContent)
            toast.success("License report generated successfully")
        } catch (error) {
            toast.error("Failed to generate report")
            console.error(error)
        } finally {
            setGeneratingReport(false)
        }
    }

    const downloadReport = (htmlContent: string) => {
        if (!htmlContent || typeof htmlContent !== 'string') {
            console.error('Invalid license report format:', htmlContent)
            toast.error('Received invalid report format from server')
            return
        }

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
        const fileName = `Veeam_License_Report_${dateStr}.html`

        try {
            const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" })

            // Forcing download using File constructor if supported, else Blob
            // But usually Blob + download attribute is enough if we are careful

            const file = new File([blob], fileName, { type: "application/octet-stream" })
            const url = window.URL.createObjectURL(file)

            const a = document.createElement("a")
            a.style.display = 'none'
            a.href = url
            a.setAttribute('download', fileName)

            document.body.appendChild(a)
            a.click()

            setTimeout(() => {
                document.body.removeChild(a)
                window.URL.revokeObjectURL(url)
                console.log("Report downloaded:", fileName)
            }, 100)
        } catch (e) {
            // Fallback for browsers that might not support File constructor fully (e.g. older Safari)
            console.warn("File constructor failed, falling back to Blob", e)
            const blob = new Blob([htmlContent], { type: "application/octet-stream" })
            const url = window.URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.style.display = 'none'
            a.href = url
            a.setAttribute('download', fileName)
            document.body.appendChild(a)
            a.click()
            setTimeout(() => {
                document.body.removeChild(a)
                window.URL.revokeObjectURL(url)
            }, 100)
        }
    }

    // Icons Helper
    const getWorkloadIcon = (type: string) => {
        const t = type.toLowerCase()
        if (t.includes('vmware') || t.includes('hyper')) return <MonitorDot className="h-4 w-4 text-blue-500" />
        if (t.includes('windows') || t.includes('linux')) return <Server className="h-4 w-4 text-indigo-500" />
        if (t.includes('file')) return <Database className="h-4 w-4 text-orange-500" /> // Use FolderClosed? User said FileShare -> FolderClosed. 
        // User said "For FileShare change lucide ... HardDrive ... for folder-closed".
        // Here explicitly check if 'file' uses Database.
        // I will change catch-all to FolderClosed.
        if (t.includes('cloud')) return <Cloud className="h-4 w-4 text-sky-500" />
        return <FolderClosed className="h-4 w-4 text-slate-500" />
    }

    if (loading) {
        return <div className="p-8 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
    }

    if (!license) return <div className="p-8">No license information available.</div>

    const summary = license.instanceLicenseSummary

    return (
        <div className="space-y-6">
            {/* Top Actions */}
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div>
                    <h3 className="text-lg font-medium">License Details</h3>
                    <p className="text-sm text-muted-foreground">Manage your license and instances</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm">
                        <Upload className="mr-2 h-4 w-4" /> Install License
                    </Button>
                    <Button variant="outline" size="sm">
                        <Trash2 className="mr-2 h-4 w-4" /> Remove License
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleCreateReport} disabled={generatingReport}>
                        {generatingReport ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                        Generate Report
                    </Button>
                    <Button size="sm" onClick={() => fetchLicense()}>
                        <RefreshCw className="mr-2 h-4 w-4" /> Update
                    </Button>
                </div>
            </div>

            <Separator />

            {/* License Info Cards */}
            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="space-y-1">
                                <p className="text-muted-foreground">Status</p>
                                <Badge variant={license.status === 'Valid' ? 'default' : 'destructive'} className="rounded-sm">
                                    {license.status}
                                </Badge>
                            </div>
                            <div className="space-y-1">
                                <p className="text-muted-foreground">Type</p>
                                <p className="font-medium">{license.type}</p>
                            </div>
                            <div className="space-y-1">
                                <p className="text-muted-foreground">Edition</p>
                                <p className="font-medium">{license.edition}</p>
                            </div>
                            <div className="space-y-1">
                                <p className="text-muted-foreground">Cloud Connect</p>
                                <p className="font-medium">{license.cloudConnect}</p>
                            </div>
                            <div className="space-y-1 col-span-2">
                                <p className="text-muted-foreground">Licensed To</p>
                                <p className="font-medium">{license.licensedTo}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Consumption</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">Instances</span>
                                <span className="font-medium">{summary.usedInstancesNumber} / {summary.licensedInstancesNumber}</span>
                            </div>
                            <Progress value={(summary.usedInstancesNumber / summary.licensedInstancesNumber) * 100} className="h-2" />
                        </div>

                        <div className="grid grid-cols-2 gap-4 pt-2">
                            <div className="p-3 bg-muted/40 rounded-lg space-y-1">
                                <p className="text-xs text-muted-foreground">Expiration Date</p>
                                <div className="flex items-center gap-2 font-medium">
                                    <Calendar className="h-4 w-4 opacity-50" />
                                    {new Date(license.expirationDate).toLocaleDateString()}
                                </div>
                            </div>
                            <div className="p-3 bg-muted/40 rounded-lg space-y-1">
                                <p className="text-xs text-muted-foreground">Support ID</p>
                                <div className="flex items-center gap-2 font-medium">
                                    <CheckCircle2 className="h-4 w-4 text-green-500 opacity-70" />
                                    {license.supportId}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Licensed Workloads Table */}
            <Card>
                <CardHeader>
                    <CardTitle>Licensed Workloads</CardTitle>
                    <CardDescription>View and manage license consumption per workload.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[50px]"></TableHead>
                                    <TableHead>Workload</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Host</TableHead>
                                    <TableHead className="text-right">Instances</TableHead>
                                    <TableHead className="w-[100px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {summary.workload.map((item) => (
                                    <TableRow key={item.instanceId}>
                                        <TableCell>
                                            {getWorkloadIcon(item.platformType)}
                                        </TableCell>
                                        <TableCell className="font-medium">
                                            <div className="flex flex-col">
                                                <span>{item.name}</span>
                                                {item.displayName !== item.name && (
                                                    <span className="text-xs text-muted-foreground">{item.displayName}</span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>{item.type}</TableCell>
                                        <TableCell className="text-muted-foreground">{item.hostName}</TableCell>
                                        <TableCell className="text-right">{item.usedInstancesNumber}</TableCell>
                                        <TableCell>
                                            {item.canBeRevoked && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="text-muted-foreground hover:text-destructive transition-colors"
                                                    onClick={() => handleRevokeClick(item)}
                                                    disabled={revokingId === item.instanceId}
                                                >
                                                    {revokingId === item.instanceId ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <Trash2 className="h-4 w-4" />
                                                    )}
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {(!summary.workload || summary.workload.length === 0) && (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-24 text-center">
                                            No workloads found.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            {/* Revoke Confirmation Dialog */}
            <AlertDialog open={isRevokeDialogOpen} onOpenChange={setIsRevokeDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Revoke License</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to revoke the license for <span className="font-semibold text-foreground">{workloadToRevoke?.name}</span>?
                            This action may impact backup jobs associated with this workload.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmRevoke} className="bg-destructive hover:bg-destructive/90">
                            Revoke License
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
