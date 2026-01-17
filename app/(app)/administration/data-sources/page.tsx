"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useDataSources, platformInfo, PlatformType, DataSource, DataSourcesProvider } from "@/lib/context/data-sources-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
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
import {
    Server,
    Cloud,
    RefreshCw,
    BarChart2,
    Database,
    Plus,
    Trash2,
    Edit2,
    CheckCircle2,
    XCircle,
    Loader2,
    Link,
    Unlink,
    Eye,
    EyeOff,
    AlertCircle
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

const platformIcons: Record<PlatformType, React.ReactNode> = {
    vbr: <Server className="h-5 w-5" />,
    vb365: <Cloud className="h-5 w-5" />,
    vro: <RefreshCw className="h-5 w-5" />,
    "veeam-one": <BarChart2 className="h-5 w-5" />,
    one: <BarChart2 className="h-5 w-5" />,
    kasten: <Database className="h-5 w-5" />
}

// Default ports for each platform (module scope for stability)
const DEFAULT_PORTS: Record<PlatformType, string> = {
    vbr: "9419",
    vb365: "4443",
    vro: "9081",
    "veeam-one": "1239",
    one: "1239",
    kasten: "443"
}

function DataSourcesContent() {
    const { dataSources, addDataSource, removeDataSource, updateDataSource, setAuthenticated } = useDataSources()
    const router = useRouter()

    // Dialog states
    const [addDialogOpen, setAddDialogOpen] = useState(false)
    const [editDialogOpen, setEditDialogOpen] = useState(false)
    const [authDialogOpen, setAuthDialogOpen] = useState(false)
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

    // Form state
    const [newSourceType, setNewSourceType] = useState<PlatformType>("vbr")
    const [newSourceHostname, setNewSourceHostname] = useState("")
    const [newSourcePort, setNewSourcePort] = useState("9419")
    const [newSourceName, setNewSourceName] = useState("")

    // Edit state
    const [editingSource, setEditingSource] = useState<DataSource | null>(null)
    const [editUrl, setEditUrl] = useState("")
    const [editName, setEditName] = useState("")

    // Delete state
    const [deletingSource, setDeletingSource] = useState<DataSource | null>(null)

    // Auth state
    const [authSource, setAuthSource] = useState<DataSource | null>(null)
    const [username, setUsername] = useState("")
    const [password, setPassword] = useState("")
    const [showPassword, setShowPassword] = useState(false)
    const [authLoading, setAuthLoading] = useState(false)
    const [authError, setAuthError] = useState<string | null>(null)

    // Session validation on mount
    useEffect(() => {
        const validateSessions = async () => {
            try {
                const response = await fetch('/api/auth/session')
                if (response.ok) {
                    const sessions = await response.json()

                    // Update authenticated status based on server sessions
                    dataSources.forEach(ds => {
                        const platformKey = ds.type === 'veeam-one' ? 'veeam-one' : ds.type
                        if (sessions[platformKey]?.authenticated) {
                            setAuthenticated(ds.id, true)
                        }
                    })
                }
            } catch (e) {
                console.error('Failed to validate sessions:', e)
            }
        }

        if (dataSources.length > 0) {
            validateSessions()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Update port when platform type changes
    useEffect(() => {
        setNewSourcePort(DEFAULT_PORTS[newSourceType])
    }, [newSourceType])

    const handleAddSource = () => {
        if (!newSourceHostname.trim()) return
        const url = `https://${newSourceHostname.trim()}:${newSourcePort}`
        addDataSource(newSourceType, url, newSourceName.trim() || undefined)
        setNewSourceHostname("")
        setNewSourcePort(DEFAULT_PORTS[newSourceType])
        setNewSourceName("")
        setAddDialogOpen(false)
        toast.success("Data source added")
    }

    const handleEditSource = () => {
        if (!editingSource || !editUrl.trim()) return
        updateDataSource(editingSource.id, { url: editUrl.trim(), name: editName.trim() || undefined })
        setEditingSource(null)
        setEditDialogOpen(false)
        toast.success("Data source updated")
    }

    const openEditDialog = (source: DataSource) => {
        setEditingSource(source)
        setEditUrl(source.url)
        setEditName(source.name)
        setEditDialogOpen(true)
    }

    const openDeleteDialog = (source: DataSource) => {
        setDeletingSource(source)
        setDeleteDialogOpen(true)
    }

    const confirmDelete = async () => {
        if (!deletingSource) return

        // Disconnect first if authenticated
        if (deletingSource.isAuthenticated) {
            try {
                await fetch(`/api/auth/${deletingSource.type}`, { method: 'DELETE' })
            } catch (e) {
                console.error('Failed to disconnect:', e)
            }
        }

        // Also call delete on server to remove from configStore
        try {
            await fetch(`/api/auth/${deletingSource.type}`, { method: 'DELETE' })
        } catch (e) {
            console.error('Failed to remove from server:', e)
        }

        removeDataSource(deletingSource.id)
        setDeletingSource(null)
        setDeleteDialogOpen(false)
        toast.success("Data source removed")

        // Redirect to /connect if no sources remain
        if (dataSources.length <= 1) {
            router.push('/connect')
        }
    }

    const openAuthDialog = (source: DataSource) => {
        setAuthSource(source)
        setUsername("")
        setPassword("")
        setShowPassword(false)
        setAuthError(null)
        setAuthDialogOpen(true)
    }

    const handleConnect = async () => {
        if (!authSource) return

        setAuthLoading(true)
        setAuthError(null)

        try {
            const response = await fetch(`/api/auth/${authSource.type}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    url: authSource.url,
                    username,
                    password
                })
            })

            if (!response.ok) {
                const data = await response.json()
                throw new Error(data.error || "Authentication failed")
            }

            setAuthenticated(authSource.id, true)
            setAuthDialogOpen(false)
            toast.success(`Connected to ${authSource.name}`)
            // Refresh server components (sidebar) to reflect the new connection
            router.refresh()
        } catch (error) {
            setAuthError(error instanceof Error ? error.message : "Authentication failed")
        } finally {
            setAuthLoading(false)
        }
    }

    const handleDisconnect = async (source: DataSource) => {
        try {
            await fetch(`/api/auth/${source.type}`, { method: 'DELETE' })
            setAuthenticated(source.id, false)
            toast.success(`Disconnected from ${source.name}`)
        } catch (error) {
            toast.error("Failed to disconnect")
            console.error(error)
        }
    }

    return (
        <div className="flex-1 overflow-auto">
            <div className="container mx-auto py-8 px-4 space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight">Data Sources</h2>
                        <p className="text-muted-foreground">Manage your Veeam platform connections</p>
                    </div>
                    <Button onClick={() => setAddDialogOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Data Source
                    </Button>
                </div>

                <Separator />

                {/* Data Sources Grid */}
                {dataSources.length === 0 ? (
                    <Card>
                        <CardContent className="flex flex-col items-center justify-center py-16">
                            <Database className="h-16 w-16 text-muted-foreground/50 mb-4" />
                            <h3 className="text-lg font-semibold mb-2">No Data Sources</h3>
                            <p className="text-muted-foreground text-center max-w-sm mb-4">
                                Add your first data source to connect to a Veeam platform.
                            </p>
                            <Button onClick={() => setAddDialogOpen(true)}>
                                <Plus className="mr-2 h-4 w-4" />
                                Add Data Source
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {dataSources.map((source) => (
                            <Card key={source.id} className={cn(
                                "transition-all",
                                source.isAuthenticated && "border-[#00b336]/30"
                            )}>
                                <CardHeader className="pb-3">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            <div
                                                className="p-2 rounded-lg"
                                                style={{ backgroundColor: `${platformInfo[source.type].color}20` }}
                                            >
                                                <div style={{ color: platformInfo[source.type].color }}>
                                                    {platformIcons[source.type]}
                                                </div>
                                            </div>
                                            <div>
                                                <CardTitle className="text-base">{source.name}</CardTitle>
                                                <CardDescription className="text-xs">
                                                    {platformInfo[source.type].description}
                                                </CardDescription>
                                            </div>
                                        </div>
                                        {source.isAuthenticated ? (
                                            <Badge variant="default" className="bg-[#00b336] text-white">
                                                <CheckCircle2 className="mr-1 h-3 w-3" />
                                                Connected
                                            </Badge>
                                        ) : (
                                            <Badge variant="secondary">
                                                <XCircle className="mr-1 h-3 w-3" />
                                                Disconnected
                                            </Badge>
                                        )}
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="text-sm text-muted-foreground truncate" title={source.url}>
                                        {source.url}
                                    </div>

                                    <div className="flex gap-2">
                                        {source.isAuthenticated ? (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="flex-1"
                                                onClick={() => handleDisconnect(source)}
                                            >
                                                <Unlink className="mr-2 h-4 w-4" />
                                                Disconnect
                                            </Button>
                                        ) : (
                                            <Button
                                                variant="default"
                                                size="sm"
                                                className="flex-1 bg-[#00b336] hover:bg-[#00a030]"
                                                onClick={() => openAuthDialog(source)}
                                            >
                                                <Link className="mr-2 h-4 w-4" />
                                                Connect
                                            </Button>
                                        )}
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            className="h-8 w-8"
                                            onClick={() => openEditDialog(source)}
                                        >
                                            <Edit2 className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            className="h-8 w-8 text-destructive hover:text-destructive"
                                            onClick={() => openDeleteDialog(source)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}

                {/* Environment Variables Info */}
                {(process.env.NEXT_PUBLIC_HAS_ENV_CONFIG === 'true') && (
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base flex items-center gap-2">
                                <AlertCircle className="h-4 w-4 text-blue-500" />
                                Environment Configuration Detected
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground">
                                Some data sources are configured via environment variables (.env file).
                                These connections are managed server-side and always available.
                            </p>
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Add Dialog */}
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Add Data Source</DialogTitle>
                        <DialogDescription>
                            Connect a new Veeam platform to your console.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Platform</Label>
                            <Select value={newSourceType} onValueChange={(v) => setNewSourceType(v as PlatformType)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {(Object.keys(platformInfo) as PlatformType[])
                                        .filter(type => type !== 'one') // Exclude alias
                                        .map((type) => (
                                            <SelectItem key={type} value={type}>
                                                <div className="flex items-center gap-2">
                                                    <span style={{ color: platformInfo[type].color }}>
                                                        {platformIcons[type]}
                                                    </span>
                                                    <span>{platformInfo[type].name}</span>
                                                </div>
                                            </SelectItem>
                                        ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Server Address</Label>
                            <div className="flex gap-2">
                                <div className="flex-1 relative">
                                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium pointer-events-none">
                                        https://
                                    </div>
                                    <Input
                                        className="pl-[4.5rem]"
                                        placeholder={{
                                            vbr: 'vbr.example.com',
                                            vb365: 'vb365.example.com',
                                            vro: 'vro.example.com',
                                            'veeam-one': 'vone.example.com',
                                            one: 'vone.example.com',
                                            kasten: 'k10.example.com'
                                        }[newSourceType] || 'server.example.com'}
                                        value={newSourceHostname}
                                        onChange={(e) => setNewSourceHostname(e.target.value)}
                                    />
                                </div>
                                <div className="w-24">
                                    <Input
                                        type="number"
                                        className="text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        placeholder={DEFAULT_PORTS[newSourceType]}
                                        value={newSourcePort}
                                        onChange={(e) => setNewSourcePort(e.target.value)}
                                    />
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Hostname/IP and Port.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label>Display Name (Optional)</Label>
                            <Input
                                placeholder={platformInfo[newSourceType].name}
                                value={newSourceName}
                                onChange={(e) => setNewSourceName(e.target.value)}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleAddSource} disabled={!newSourceHostname.trim()}>
                            Add Source
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit Dialog */}
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Edit Data Source</DialogTitle>
                        <DialogDescription>
                            Update the connection details. Changing the URL will require re-authentication.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>API URL</Label>
                            <Input
                                value={editUrl}
                                onChange={(e) => setEditUrl(e.target.value)}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Display Name</Label>
                            <Input
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleEditSource} disabled={!editUrl.trim()}>
                            Save Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Auth Dialog */}
            <Dialog open={authDialogOpen} onOpenChange={setAuthDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Connect to {authSource?.name}</DialogTitle>
                        <DialogDescription>
                            Enter your credentials to authenticate.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        {authError && (
                            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-center gap-2 text-destructive text-sm">
                                <XCircle className="h-4 w-4" />
                                {authError}
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label>Username</Label>
                            <Input
                                placeholder="domain\\username or username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                disabled={authLoading}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Password</Label>
                            <div className="relative">
                                <Input
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    disabled={authLoading}
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="absolute right-0 top-0 h-full"
                                    onClick={() => setShowPassword(!showPassword)}
                                >
                                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </Button>
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAuthDialogOpen(false)} disabled={authLoading}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleConnect}
                            disabled={authLoading || !username || !password}
                            className="bg-[#00b336] hover:bg-[#00a030]"
                        >
                            {authLoading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Connecting...
                                </>
                            ) : (
                                "Connect"
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove Data Source</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to remove <span className="font-semibold">{deletingSource?.name}</span>?
                            This will disconnect the session and remove the configuration.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} className="bg-destructive hover:bg-destructive/90">
                            Remove
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}

export default function DataSourcesPage() {
    return (
        <DataSourcesProvider>
            <DataSourcesContent />
        </DataSourcesProvider>
    )
}
