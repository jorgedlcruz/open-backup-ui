"use client"

import { useState, useEffect, useCallback } from "react"
import { veeamApi } from "@/lib/api/veeam-client"
import { VB365Proxy } from "@/lib/types/vbm"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
    Loader2,
    RefreshCw,
    Server,
    Wrench,
    Play,
    Cpu,
    HardDrive
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
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"

export default function VB365ProxiesPage() {
    const [proxies, setProxies] = useState<VB365Proxy[]>([])
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState<string | null>(null)

    const fetchProxies = useCallback(async () => {
        try {
            setLoading(true)
            const data = await veeamApi.getVB365Proxies({ limit: 100 })
            setProxies(data)
        } catch (error) {
            toast.error("Failed to load proxies")
            console.error(error)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchProxies()
    }, [fetchProxies])

    const handleRescan = async (proxy: VB365Proxy) => {
        try {
            setActionLoading(proxy.id)
            await veeamApi.rescanVB365Proxy(proxy.id)
            toast.success(`Rescan started for ${proxy.hostName}`)
            await fetchProxies()
        } catch (error) {
            toast.error(`Failed to rescan: ${error instanceof Error ? error.message : 'Unknown error'}`)
        } finally {
            setActionLoading(null)
        }
    }

    const handleMaintenanceMode = async (proxy: VB365Proxy, enable: boolean) => {
        try {
            setActionLoading(proxy.id)
            await veeamApi.setVB365ProxyMaintenanceMode(proxy.id, enable)
            toast.success(`Maintenance mode ${enable ? 'enabled' : 'disabled'} for ${proxy.hostName}`)
            await fetchProxies()
        } catch (error) {
            toast.error(`Failed to set maintenance mode: ${error instanceof Error ? error.message : 'Unknown error'}`)
        } finally {
            setActionLoading(null)
        }
    }

    const getStatusBadge = (status: string) => {
        switch (status.toLowerCase()) {
            case 'online':
                return <Badge variant="default" className="bg-green-600">Online</Badge>
            case 'offline':
                return <Badge variant="destructive">Offline</Badge>
            case 'warning':
                return <Badge variant="secondary" className="bg-yellow-600">Warning</Badge>
            default:
                return <Badge variant="outline">{status}</Badge>
        }
    }

    return (
        <div className="flex-1 overflow-auto">
            <div className="container mx-auto py-8 px-4 space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Backup Proxies</h1>
                        <p className="text-muted-foreground">
                            Manage your VB365 backup proxy infrastructure
                        </p>
                    </div>
                    <Button onClick={fetchProxies} disabled={loading}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                </div>

                {/* Summary Cards */}
                <div className="grid gap-4 md:grid-cols-3">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Total Proxies</CardTitle>
                            <Server className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{proxies.length}</div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Online</CardTitle>
                            <div className="h-2 w-2 rounded-full bg-green-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">
                                {proxies.filter(p => p.status?.toLowerCase() === 'online').length}
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">In Maintenance</CardTitle>
                            <Wrench className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">
                                {proxies.filter(p => p.maintenanceModeState?.toLowerCase() === 'enabled').length}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Proxies Table */}
                <Card>
                    <CardHeader>
                        <CardTitle>Proxy Servers</CardTitle>
                        <CardDescription>View and manage backup proxy servers</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <div className="flex items-center justify-center h-32">
                                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                            </div>
                        ) : (
                            <div className="rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Host</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead>Type</TableHead>
                                            <TableHead>OS</TableHead>
                                            <TableHead>
                                                <div className="flex items-center gap-1">
                                                    <Cpu className="h-3 w-3" /> CPU
                                                </div>
                                            </TableHead>
                                            <TableHead>
                                                <div className="flex items-center gap-1">
                                                    <HardDrive className="h-3 w-3" /> Memory
                                                </div>
                                            </TableHead>
                                            <TableHead>Version</TableHead>
                                            <TableHead>Roles</TableHead>
                                            <TableHead className="w-[100px]"></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {proxies.map((proxy) => (
                                            <TableRow key={proxy.id}>
                                                <TableCell>
                                                    <div className="flex flex-col">
                                                        <span className="font-medium">{proxy.hostName}</span>
                                                        <span className="text-xs text-muted-foreground">{proxy.fqdn}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col gap-1">
                                                        {getStatusBadge(proxy.status)}
                                                        {proxy.maintenanceModeState?.toLowerCase() === 'enabled' && (
                                                            <Badge variant="outline" className="text-xs">
                                                                <Wrench className="h-3 w-3 mr-1" /> Maintenance
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell>{proxy.type}</TableCell>
                                                <TableCell>{proxy.operatingSystem}</TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2 min-w-[80px]">
                                                        <Progress value={proxy.cpuUsagePercent} className="h-2 flex-1" />
                                                        <span className="text-xs text-muted-foreground w-10">
                                                            {proxy.cpuUsagePercent?.toFixed(0)}%
                                                        </span>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2 min-w-[80px]">
                                                        <Progress value={proxy.memoryUsagePercent} className="h-2 flex-1" />
                                                        <span className="text-xs text-muted-foreground w-10">
                                                            {proxy.memoryUsagePercent?.toFixed(0)}%
                                                        </span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-muted-foreground text-sm">{proxy.version}</TableCell>
                                                <TableCell>
                                                    <div className="flex flex-wrap gap-1">
                                                        {proxy.role?.slice(0, 2).map((role) => (
                                                            <Badge key={role} variant="outline" className="text-xs">
                                                                {role}
                                                            </Badge>
                                                        ))}
                                                        {proxy.role?.length > 2 && (
                                                            <Badge variant="outline" className="text-xs">
                                                                +{proxy.role.length - 2}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                disabled={actionLoading === proxy.id}
                                                            >
                                                                {actionLoading === proxy.id ? (
                                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                                ) : (
                                                                    "Actions"
                                                                )}
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuItem onClick={() => handleRescan(proxy)}>
                                                                <RefreshCw className="mr-2 h-4 w-4" />
                                                                Rescan
                                                            </DropdownMenuItem>
                                                            {proxy.maintenanceModeState?.toLowerCase() === 'enabled' ? (
                                                                <DropdownMenuItem onClick={() => handleMaintenanceMode(proxy, false)}>
                                                                    <Play className="mr-2 h-4 w-4" />
                                                                    Disable Maintenance
                                                                </DropdownMenuItem>
                                                            ) : (
                                                                <DropdownMenuItem onClick={() => handleMaintenanceMode(proxy, true)}>
                                                                    <Wrench className="mr-2 h-4 w-4" />
                                                                    Enable Maintenance
                                                                </DropdownMenuItem>
                                                            )}
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        {proxies.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={9} className="h-24 text-center">
                                                    No proxies found.
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
