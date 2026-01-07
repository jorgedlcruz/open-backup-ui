"use client"

import { useState, useEffect } from "react"
import { veeamApi } from "@/lib/api/veeam-client"
import { LicenseModel, LicenseWorkload } from "@/lib/types/veeam"
import { VB365License, VB365LicensedUser } from "@/lib/types/vbm"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    Loader2,
    Trash2,
    RefreshCw,
    Upload,
    FileText,
    Server,
    Database,
    Cloud,
    CheckCircle2,
    Calendar,
    FolderClosed,
    MonitorDot,
    User
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
    const [activeTab, setActiveTab] = useState<"vbr" | "vb365">("vbr")
    const [hasVB365, setHasVB365] = useState(false)

    // VBR State
    const [license, setLicense] = useState<LicenseModel | null>(null)
    const [loading, setLoading] = useState(true)
    const [revokingId, setRevokingId] = useState<string | null>(null)
    const [generatingReport, setGeneratingReport] = useState(false)

    // VB365 State 
    const [vb365License, setVB365License] = useState<VB365License | null>(null)
    const [vb365LicensedUsers, setVB365LicensedUsers] = useState<VB365LicensedUser[]>([])
    const [vb365Loading, setVB365Loading] = useState(false)
    const [vb365RevokingId, setVB365RevokingId] = useState<string | null>(null)

    // Revoke Dialog State
    const [isRevokeDialogOpen, setIsRevokeDialogOpen] = useState(false)
    const [workloadToRevoke, setWorkloadToRevoke] = useState<LicenseWorkload | null>(null)

    // VB365 Revoke Dialog State
    const [isVB365RevokeDialogOpen, setIsVB365RevokeDialogOpen] = useState(false)
    const [userToRevoke, setUserToRevoke] = useState<VB365LicensedUser | null>(null)

    // Check VB365 availability on mount
    useEffect(() => {
        const checkVB365 = async () => {
            try {
                // Try to get VB365 license to see if it's configured
                const vb365Data = await veeamApi.getVBMLicense()
                if (vb365Data && vb365Data.licenseID) {
                    setHasVB365(true)
                }
            } catch {
                // VB365 not configured
                setHasVB365(false)
            }
        }
        checkVB365()
    }, [])

    const fetchVBRLicense = async () => {
        try {
            setLoading(true)
            const data = await veeamApi.getLicenseInfo()
            setLicense(data)
        } catch (error) {
            toast.error("Failed to load VBR license info")
            console.error(error)
        } finally {
            setLoading(false)
        }
    }

    const fetchVB365Data = async () => {
        try {
            setVB365Loading(true)
            const [licenseData, usersData] = await Promise.all([
                veeamApi.getVBMLicense(),
                veeamApi.getVB365LicensedUsers({ limit: 1000 })
            ])
            setVB365License(licenseData as unknown as VB365License)
            setVB365LicensedUsers(usersData)
        } catch (error) {
            toast.error("Failed to load VB365 license info")
            console.error(error)
        } finally {
            setVB365Loading(false)
        }
    }

    useEffect(() => {
        fetchVBRLicense()
    }, [])

    useEffect(() => {
        if (activeTab === "vb365" && hasVB365) {
            fetchVB365Data()
        }
    }, [activeTab, hasVB365])

    const handleRevokeClick = (workload: LicenseWorkload) => {
        setWorkloadToRevoke(workload)
        setIsRevokeDialogOpen(true)
    }

    const confirmRevoke = async () => {
        if (!workloadToRevoke) return

        try {
            setRevokingId(workloadToRevoke.instanceId)
            if (workloadToRevoke.platformType === 'UnstructuredData') {
                await veeamApi.revokeLicenseCapacity(workloadToRevoke.instanceId)
            } else {
                await veeamApi.revokeLicenseInstance(workloadToRevoke.instanceId)
            }

            toast.success(`License revoked for ${workloadToRevoke.name}`)
            await fetchVBRLicense()
        } catch (error) {
            toast.error(`Failed to revoke license: ${error instanceof Error ? error.message : 'Unknown error'}`)
        } finally {
            setRevokingId(null)
            setIsRevokeDialogOpen(false)
            setWorkloadToRevoke(null)
        }
    }

    const handleVB365RevokeClick = (user: VB365LicensedUser) => {
        setUserToRevoke(user)
        setIsVB365RevokeDialogOpen(true)
    }

    const confirmVB365Revoke = async () => {
        if (!userToRevoke) return

        try {
            setVB365RevokingId(userToRevoke.id)
            await veeamApi.revokeVB365License(userToRevoke.id)
            toast.success(`License revoked for ${userToRevoke.name}`)
            await fetchVB365Data()
        } catch (error) {
            toast.error(`Failed to revoke license: ${error instanceof Error ? error.message : 'Unknown error'}`)
        } finally {
            setVB365RevokingId(null)
            setIsVB365RevokeDialogOpen(false)
            setUserToRevoke(null)
        }
    }

    const handleCreateReport = async () => {
        try {
            setGeneratingReport(true)
            if (activeTab === "vbr") {
                const htmlContent = await veeamApi.createLicenseReport()
                downloadHtmlReport(htmlContent)
            } else {
                // VB365 PDF report
                const now = new Date()
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
                const blob = await veeamApi.generateVB365LicenseReport(
                    startOfMonth.toISOString(),
                    now.toISOString()
                )
                downloadPdfReport(blob)
            }
            toast.success("License report generated successfully")
        } catch (error) {
            toast.error("Failed to generate report")
            console.error(error)
        } finally {
            setGeneratingReport(false)
        }
    }

    const downloadHtmlReport = (htmlContent: string) => {
        if (!htmlContent || typeof htmlContent !== 'string') {
            toast.error('Received invalid report format from server')
            return
        }

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
        const fileName = `Veeam_VBR_License_Report_${dateStr}.html`

        try {
            const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" })
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
            }, 100)
        } catch {
            toast.error("Failed to download report")
        }
    }

    const downloadPdfReport = (blob: Blob) => {
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
        const fileName = `Veeam_VB365_License_Report_${dateStr}.pdf`

        try {
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
        } catch {
            toast.error("Failed to download report")
        }
    }

    const getWorkloadIcon = (type: string) => {
        const t = type.toLowerCase()
        if (t.includes('vmware') || t.includes('hyper')) return <MonitorDot className="h-4 w-4 text-blue-500" />
        if (t.includes('windows') || t.includes('linux')) return <Server className="h-4 w-4 text-indigo-500" />
        if (t.includes('file')) return <Database className="h-4 w-4 text-orange-500" />
        if (t.includes('cloud')) return <Cloud className="h-4 w-4 text-sky-500" />
        return <FolderClosed className="h-4 w-4 text-slate-500" />
    }

    const handleRefresh = () => {
        if (activeTab === "vbr") {
            fetchVBRLicense()
        } else {
            fetchVB365Data()
        }
    }

    if (loading && !license) {
        return <div className="p-8 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
    }

    return (
        <div className="flex-1 overflow-auto">
            <div className="container mx-auto py-8 px-4 space-y-4">
                {/* Top Actions */}
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight">License Details</h2>
                        <p className="text-muted-foreground">Manage your license and instances</p>
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
                        <Button size="sm" onClick={handleRefresh}>
                            <RefreshCw className="mr-2 h-4 w-4" /> Update
                        </Button>
                    </div>
                </div>

                <Separator />

                {/* Tabs */}
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "vbr" | "vb365")} className="space-y-4">
                    <TabsList>
                        <TabsTrigger value="vbr">Veeam Backup & Replication</TabsTrigger>
                        {hasVB365 && (
                            <TabsTrigger value="vb365">Veeam Backup for Microsoft 365</TabsTrigger>
                        )}
                    </TabsList>

                    {/* VBR Tab Content */}
                    <TabsContent value="vbr" className="space-y-6">
                        {!license ? (
                            <div className="p-8 text-center text-muted-foreground">No VBR license information available.</div>
                        ) : (
                            <>
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
                                                    <span className="font-medium">{license.instanceLicenseSummary.usedInstancesNumber} / {license.instanceLicenseSummary.licensedInstancesNumber}</span>
                                                </div>
                                                <Progress value={(license.instanceLicenseSummary.usedInstancesNumber / license.instanceLicenseSummary.licensedInstancesNumber) * 100} className="h-2" />
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
                                                    {license.instanceLicenseSummary.workload.map((item) => (
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
                                                    {(!license.instanceLicenseSummary.workload || license.instanceLicenseSummary.workload.length === 0) && (
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
                            </>
                        )}
                    </TabsContent>

                    {/* VB365 Tab Content */}
                    <TabsContent value="vb365" className="space-y-6">
                        {vb365Loading ? (
                            <div className="p-8 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
                        ) : !vb365License ? (
                            <div className="p-8 text-center text-muted-foreground">No VB365 license information available.</div>
                        ) : (
                            <>
                                {/* VB365 License Info Cards */}
                                <div className="grid gap-6 md:grid-cols-2">
                                    <Card>
                                        <CardHeader>
                                            <CardTitle className="text-base">Information</CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <div className="grid grid-cols-2 gap-4 text-sm">
                                                <div className="space-y-1">
                                                    <p className="text-muted-foreground">Status</p>
                                                    <Badge variant={vb365License.status === 'Valid' ? 'default' : 'destructive'} className="rounded-sm">
                                                        {vb365License.status}
                                                    </Badge>
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-muted-foreground">Type</p>
                                                    <p className="font-medium">{vb365License.type}</p>
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-muted-foreground">Package</p>
                                                    <p className="font-medium">{vb365License.package}</p>
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-muted-foreground">Support ID</p>
                                                    <p className="font-medium">{vb365License.supportID}</p>
                                                </div>
                                                <div className="space-y-1 col-span-2">
                                                    <p className="text-muted-foreground">Licensed To</p>
                                                    <p className="font-medium">{vb365License.licensedTo}</p>
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
                                                    <span className="text-muted-foreground">Users</span>
                                                    <span className="font-medium">{vb365License.usedNumber} / {vb365License.totalNumber}</span>
                                                </div>
                                                <Progress value={(vb365License.usedNumber / vb365License.totalNumber) * 100} className="h-2" />
                                            </div>

                                            <div className="grid grid-cols-2 gap-4 pt-2">
                                                <div className="p-3 bg-muted/40 rounded-lg space-y-1">
                                                    <p className="text-xs text-muted-foreground">Expiration Date</p>
                                                    <div className="flex items-center gap-2 font-medium">
                                                        <Calendar className="h-4 w-4 opacity-50" />
                                                        {new Date(vb365License.licenseExpires).toLocaleDateString()}
                                                    </div>
                                                </div>
                                                <div className="p-3 bg-muted/40 rounded-lg space-y-1">
                                                    <p className="text-xs text-muted-foreground">New Users</p>
                                                    <div className="flex items-center gap-2 font-medium">
                                                        <User className="h-4 w-4 opacity-50" />
                                                        {vb365License.newNumber}
                                                    </div>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </div>

                                {/* VB365 Licensed Users Table */}
                                <Card>
                                    <CardHeader>
                                        <CardTitle>Licensed Users</CardTitle>
                                        <CardDescription>View and manage licensed Microsoft 365 users.</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="rounded-md border">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead className="w-[50px]"></TableHead>
                                                        <TableHead>User</TableHead>
                                                        <TableHead>Organization</TableHead>
                                                        <TableHead>Last Backup</TableHead>
                                                        <TableHead>Status</TableHead>
                                                        <TableHead className="w-[100px]"></TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {vb365LicensedUsers.map((user) => (
                                                        <TableRow key={user.id}>
                                                            <TableCell>
                                                                <User className="h-4 w-4 text-blue-500" />
                                                            </TableCell>
                                                            <TableCell className="font-medium">{user.name}</TableCell>
                                                            <TableCell className="text-muted-foreground">{user.organizationName}</TableCell>
                                                            <TableCell className="text-muted-foreground">
                                                                {user.lastBackupDate ? new Date(user.lastBackupDate).toLocaleString() : 'Never'}
                                                            </TableCell>
                                                            <TableCell>
                                                                <Badge variant={user.licenseState === 'Licensed' ? 'default' : 'secondary'} className="rounded-sm">
                                                                    {user.licenseState}
                                                                </Badge>
                                                            </TableCell>
                                                            <TableCell>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="text-muted-foreground hover:text-destructive transition-colors"
                                                                    onClick={() => handleVB365RevokeClick(user)}
                                                                    disabled={vb365RevokingId === user.id}
                                                                >
                                                                    {vb365RevokingId === user.id ? (
                                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                                    ) : (
                                                                        <Trash2 className="h-4 w-4" />
                                                                    )}
                                                                </Button>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                    {vb365LicensedUsers.length === 0 && (
                                                        <TableRow>
                                                            <TableCell colSpan={6} className="h-24 text-center">
                                                                No licensed users found.
                                                            </TableCell>
                                                        </TableRow>
                                                    )}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    </CardContent>
                                </Card>
                            </>
                        )}
                    </TabsContent>
                </Tabs>

                {/* VBR Revoke Confirmation Dialog */}
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

                {/* VB365 Revoke Confirmation Dialog */}
                <AlertDialog open={isVB365RevokeDialogOpen} onOpenChange={setIsVB365RevokeDialogOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Revoke License</AlertDialogTitle>
                            <AlertDialogDescription>
                                Are you sure you want to revoke the license for <span className="font-semibold text-foreground">{userToRevoke?.name}</span>?
                                You cannot revoke a license from a user if the backup repository contains data of this user.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={confirmVB365Revoke} className="bg-destructive hover:bg-destructive/90">
                                Revoke License
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </div>
    )
}
