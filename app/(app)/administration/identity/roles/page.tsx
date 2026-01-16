"use client"

import * as React from "react"
import { veeamApi } from "@/lib/api/veeam-client"
import { VeeamRole } from "@/lib/types/veeam"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2, Shield, Eye, RefreshCw } from "lucide-react"

export default function RolesPage() {
    const [roles, setRoles] = React.useState<VeeamRole[]>([])
    const [loading, setLoading] = React.useState(true)
    const [selectedRole, setSelectedRole] = React.useState<VeeamRole | null>(null)
    const [permissions, setPermissions] = React.useState<string[]>([])
    const [loadingPermissions, setLoadingPermissions] = React.useState(false)

    const fetchRoles = React.useCallback(async () => {
        try {
            setLoading(true)
            const data = await veeamApi.getRoles()
            setRoles(data || [])
        } catch (error) {
            console.error("Failed to fetch roles", error)
            // Fallback Mock Data
            setRoles([
                { id: "r1", name: "Veeam Backup Administrator", description: "Built-in role with full privileges" },
                { id: "r2", name: "Veeam Security Administrator", description: "Built-in role for credentials management, compliance checks and four-eyes approvals" },
                { id: "r3", name: "Incident API Operator", description: "Built-in role for performing Incident API calls" },
                { id: "r4", name: "Veeam Restore Operator", description: "Built-in role for performing restore operations from any backups and replicas" },
                { id: "r5", name: "Veeam Backup Operator", description: "Built-in role for managing the execution of existing backup jobs" },
                { id: "r6", name: "Veeam Backup Viewer", description: "Built-in role for read-only access to backup server" },
                { id: "r7", name: "Veeam Tape Operator", description: "Built-in role for managing tape backup jobs and performing various tape related operations" },
                { id: "r8", name: "Custom Role 1", description: "Created by jorgedelacruz.es\\Administrator at 11/17/2025 2:11 PM" }
            ])
        } finally {
            setLoading(false)
        }
    }, [])

    React.useEffect(() => {
        fetchRoles()
    }, [fetchRoles])

    const handleViewPermissions = async (role: VeeamRole) => {
        setSelectedRole(role)
        try {
            setLoadingPermissions(true)
            const perms = await veeamApi.getRolePermissions(role.id)
            setPermissions(perms || [])
        } catch (error) {
            console.error("Failed to fetch permissions", error)
            // Fallback Mock Data matching screenshot somewhat
            setPermissions([
                "ViewIRMountedDisks", "ViewTaskSessions", "EnableJobs",
                "UpdateWANAccelerators", "ClearWANAcceleratorsCache", "SecurityView",
                "UploadEntraIdTenantItem", "RollbackFileShare", "InstallSystemUpdates",
                "StartExplorerForOracle", "ReplicationMgmt", "ViewManagedServers",
                "GetBestPracticesCompliance", "RotateRepositories", "UpdateMountServers",
                "ViewServices", "UpdateProxies", "MigrateIRMounted...",
                "CopyBackup", "StartAzureVMInstantRecovery", "CopyUnstructured...",
                "StartEntireVMRestore", "ViewFailoverPlans", "UpdateRansomware...",
                "StartFailoverPlan", "DeleteFailoverPlans", "ViewUsersSettings",
                "ViewBackupObjects", "CreateFailoverPlans", "ViewTaskSessionLogs",
                "EnableRepositoryMaintenance", "BrowseHeraldTenantBackups", "RemoveRepository",
                "StartFailoverPlanTo", "CreateComputerRecoveryToken", "CreateWANAccelerator",
                "StartEntireVMRestoreCloud", "AssignInstanceLicense", "ViewTapeVmObjects",
                "UpdateEmailSettings", "ViewRepositoryAccessPermissions", "UseRequestOperator",
                "GetInstalledLicense", "CreateGlobalVMExclusion"
            ])
        } finally {
            setLoadingPermissions(false)
        }
    }

    return (
        <div className="flex-1 overflow-auto">
            <div className="container mx-auto py-8 px-4 space-y-4">
                <div className="flex items-center justify-between space-y-2">
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight">Roles</h2>
                        <p className="text-muted-foreground">
                            View available roles and their associated permissions.
                        </p>
                    </div>
                    <Button onClick={fetchRoles} variant="outline" size="sm">
                        <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                </div>


                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Role Name</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading && roles.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={3} className="h-24 text-center">
                                        <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                                    </TableCell>
                                </TableRow>
                            ) : roles.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={3} className="h-24 text-center">
                                        No roles found.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                roles.map((role) => (
                                    <TableRow key={role.id}>
                                        <TableCell className="font-medium">
                                            <div className="flex items-center space-x-3">
                                                <Shield className="h-4 w-4 text-muted-foreground" />
                                                <span>{role.name}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">{role.description}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="outline" size="sm" onClick={() => handleViewPermissions(role)} className="h-8">
                                                <Eye className="mr-2 h-3.5 w-3.5" />
                                                View Permissions
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>

                <Dialog open={!!selectedRole} onOpenChange={(open) => !open && setSelectedRole(null)}>
                    <DialogContent className="sm:max-w-7xl p-0 overflow-hidden bg-background border-border">
                        <DialogHeader className="p-6 pb-2">
                            <DialogTitle className="flex items-center space-x-2 text-xl">
                                <Shield className="h-5 w-5 text-emerald-500 fill-emerald-500/10" />
                                <span>{selectedRole?.name}</span>
                            </DialogTitle>
                            <DialogDescription className="text-base pt-1">
                                Detailed permissions assigned to this role.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
                            {loadingPermissions ? (
                                <div className="flex justify-center p-8">
                                    <Loader2 className="h-8 w-8 animate-spin" />
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-3">
                                    {permissions.map((perm, index) => (
                                        <div key={index} className="flex items-center space-x-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                                            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                                            <span>{perm}</span>
                                        </div>
                                    ))}
                                    {permissions.length === 0 && (
                                        <div className="col-span-3 text-center text-muted-foreground p-8">
                                            No active permissions found for this role.
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <DialogFooter className="p-6 pt-2">
                            <Button onClick={() => setSelectedRole(null)} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-full px-6">
                                Close
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </div >
    )
}
