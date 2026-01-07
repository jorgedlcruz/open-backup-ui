"use client"

import * as React from "react"

import { veeamApi } from "@/lib/api/veeam-client"
import { VeeamUser, SecuritySettings, VeeamRole } from "@/lib/types/veeam"
import { deleteUserAction, resetMFAAction, toggleServiceAccountAction, updateMFAAction } from "@/app/actions/identity-actions"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { MoreHorizontal, User, Users, Shield, Loader2, RefreshCw } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
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
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

export default function UsersPage() {

    const [users, setUsers] = React.useState<VeeamUser[]>([])
    const [roles, setRoles] = React.useState<VeeamRole[]>([])
    const [loading, setLoading] = React.useState(true)
    const [securitySettings, setSecuritySettings] = React.useState<SecuritySettings>({ mfaEnabled: false })

    // Roles Dialog State
    const [isRolesDialogOpen, setIsRolesDialogOpen] = React.useState(false)
    const [editingUser, setEditingUser] = React.useState<VeeamUser | null>(null)
    const [selectedRoleIds, setSelectedRoleIds] = React.useState<string[]>([])
    const [savingRoles, setSavingRoles] = React.useState(false)

    // Delete Confirmation State
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false)
    const [deletingUser, setDeletingUser] = React.useState<VeeamUser | null>(null)
    const [isDeleting, setIsDeleting] = React.useState(false)

    const fetchData = React.useCallback(async () => {
        try {
            setLoading(true)
            const [usersData, rolesData, settingsData] = await Promise.all([
                veeamApi.getUsers(),
                veeamApi.getRoles(),
                veeamApi.getSecuritySettings(),
            ])
            setUsers(usersData)
            setRoles(rolesData)
            setSecuritySettings(settingsData)
        } catch (error) {
            console.error("Failed to fetch data", error)
            // Fallback Mock Data for UI verification if API fails
            setUsers([
                {
                    id: "1",
                    name: "Administrator",
                    type: "InternalUser",
                    roles: [{ id: "r1", name: "Veeam Backup Administrator", description: "Full access" }],
                    isServiceAccount: false,
                    enabled: true
                }
            ])
            setRoles([
                { id: "r1", name: "Veeam Backup Administrator", description: "Full access" },
                { id: "r2", name: "Veeam Restore Operator", description: "Can restore backups" },
                { id: "r3", name: "Veeam Tape Operator", description: "Can manage tapes" }
            ])
            setSecuritySettings({ mfaEnabled: false })
        } finally {
            setLoading(false)
        }
    }, [])

    React.useEffect(() => {
        fetchData()
    }, [fetchData])

    const openDeleteDialog = (user: VeeamUser) => {
        setDeletingUser(user)
        setIsDeleteDialogOpen(true)
    }

    const executeDelete = async () => {
        if (!deletingUser) return

        setIsDeleting(true)
        const result = await deleteUserAction(deletingUser.id)
        setIsDeleting(false)
        setIsDeleteDialogOpen(false)
        setDeletingUser(null)

        if (result.success) {
            toast.success("User deleted successfully")
            fetchData()
        } else {
            if (result.error?.includes('four-eyes authorization')) {
                toast.error("Unable to perform the operation as four-eyes authorization is enabled. Please perform this operation using regular Veeam Backup & Replication Console.")
            } else {
                toast.error(result.error || "Failed to delete user")
            }
        }
    }

    const handleResetMFA = async (id: string) => {
        const result = await resetMFAAction(id)
        if (result.success) {
            toast.success("MFA reset successfully")
        } else {
            if (result.error?.includes('four-eyes authorization')) {
                toast.error("Unable to perform the operation as four-eyes authorization is enabled. Please perform this operation using regular Veeam Backup & Replication Console.")
            } else {
                toast.error(result.error || "Failed to reset MFA")
            }
        }
    }

    const handleToggleServiceAccount = async (id: string, current: boolean) => {
        // Optimistic update
        setUsers(users.map(u => u.id === id ? { ...u, isServiceAccount: !current } : u))
        const result = await toggleServiceAccountAction(id, !current)
        if (result.success) {
            toast.success("Service account status updated")
        } else {
            // Revert optimistic update
            setUsers(users.map(u => u.id === id ? { ...u, isServiceAccount: current } : u))
            if (result.error?.includes('four-eyes authorization')) {
                toast.error("Unable to perform the operation as four-eyes authorization is enabled. Please perform this operation using regular Veeam Backup & Replication Console.")
            } else {
                toast.error(result.error || "Failed to update status")
            }
        }
    }

    const handleGlobalMFAToggle = async (checked: boolean) => {
        setSecuritySettings({ ...securitySettings, mfaEnabled: checked })
        const result = await updateMFAAction(checked)
        if (!result.success) {
            setSecuritySettings({ ...securitySettings, mfaEnabled: !checked })
            // Check for four-eyes authorization specific error
            if (result.error?.includes('four-eyes authorization')) {
                toast.error("Unable to perform the operation as four-eyes authorization is enabled. Please perform this operation using regular Veeam Backup & Replication Console.")
            } else {
                toast.error("Failed to update MFA settings")
            }
        } else {
            toast.success(`MFA ${checked ? 'Enforced' : 'Disabled'}`)
        }
    }

    const openRolesDialog = (user: VeeamUser) => {
        setEditingUser(user)
        setSelectedRoleIds(user.roles.map(r => r.id))
        setIsRolesDialogOpen(true)
    }

    const handleSaveRoles = async () => {
        if (!editingUser) return

        try {
            setSavingRoles(true)
            // Construct new roles array based on selection
            const newRoles = roles.filter(r => selectedRoleIds.includes(r.id))

            // Call API to update roles
            await veeamApi.updateUserRoles(editingUser.id, newRoles)

            toast.success("User roles updated successfully")
            setIsRolesDialogOpen(false)
            fetchData() // Refresh list
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to update user roles"
            console.warn("Update roles:", message)
            if (message.includes('four-eyes authorization')) {
                toast.error("Unable to perform the operation as four-eyes authorization is enabled. Please perform this operation using regular Veeam Backup & Replication Console.")
            } else {
                toast.error(message)
            }
        } finally {
            setSavingRoles(false)
        }
    }

    return (
        <div className="flex-1 overflow-auto">
            <div className="container mx-auto py-8 px-4 space-y-4">
                <div className="flex items-center justify-between space-y-2">
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight">Users</h2>
                        <p className="text-muted-foreground">
                            Manage users, service accounts, and security settings.
                        </p>
                    </div>
                    <div className="flex items-center space-x-2">
                        <div className="flex items-center space-x-2 px-3 h-9 rounded-md border bg-card">
                            <Shield className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium mr-2">Enforce MFA</span>
                            <Switch
                                checked={securitySettings.mfaEnabled}
                                onCheckedChange={handleGlobalMFAToggle}
                                className="scale-75 origin-right"
                            />
                        </div>
                        <Button onClick={fetchData} variant="outline" size="sm">
                            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                            Refresh
                        </Button>
                        <Button size="sm">
                            <Users className="mr-2 h-4 w-4" />
                            Add User
                        </Button>
                    </div>
                </div>


                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Target</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Roles</TableHead>
                                <TableHead>Service Account</TableHead>
                                <TableHead className="w-[100px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading && users.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center">
                                        <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                                    </TableCell>
                                </TableRow>
                            ) : users.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center">
                                        No users found.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                users.map((user) => (
                                    <TableRow key={user.id}>
                                        <TableCell className="font-medium">
                                            <div className="flex items-center space-x-2">
                                                <User className="h-4 w-4 text-muted-foreground" />
                                                <span>{user.name}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>{user.type}</TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap gap-1">
                                                {user.roles.map(role => (
                                                    <Badge key={role.id} variant="secondary">
                                                        {role.name}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Switch
                                                checked={user.isServiceAccount}
                                                onCheckedChange={() => handleToggleServiceAccount(user.id, user.isServiceAccount)}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" className="h-8 w-8 p-0">
                                                        <span className="sr-only">Open menu</span>
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onSelect={() => handleResetMFA(user.id)}>
                                                        Reset MFA
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onSelect={() => openRolesDialog(user)}>
                                                        Edit Roles
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem className="text-destructive" onSelect={() => openDeleteDialog(user)}>
                                                        Delete User
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>

            <Dialog open={isRolesDialogOpen} onOpenChange={setIsRolesDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Roles</DialogTitle>
                        <DialogDescription>
                            Select the roles for user <span className="font-medium">{editingUser?.name}</span>.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        {roles.map((role) => (
                            <div key={role.id} className="flex items-start space-x-3 space-y-0">
                                <Checkbox
                                    id={`role-${role.id}`}
                                    checked={selectedRoleIds.includes(role.id)}
                                    onCheckedChange={(checked) => {
                                        if (checked) {
                                            setSelectedRoleIds([...selectedRoleIds, role.id])
                                        } else {
                                            setSelectedRoleIds(selectedRoleIds.filter(id => id !== role.id))
                                        }
                                    }}
                                />
                                <div className="grid gap-1.5 leading-none">
                                    <Label
                                        htmlFor={`role-${role.id}`}
                                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                    >
                                        {role.name}
                                    </Label>
                                    <p className="text-sm text-muted-foreground">
                                        {role.description}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsRolesDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleSaveRoles} disabled={savingRoles}>
                            {savingRoles && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete User</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete <span className="font-medium">{deletingUser?.name}</span>? This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={executeDelete}
                            disabled={isDeleting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div >
    )
}
