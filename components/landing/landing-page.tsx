"use client"
// Open Backup UI v1.0.2

import { useI18n } from "@/components/providers/i18n-provider"

import { useState, useEffect } from "react"
import { useTheme } from "next-themes"
import { FeatureCarousel } from "@/components/landing/feature-carousel"
import {
    Server,
    Cloud,
    RefreshCw,
    BarChart2,
    Database,
    Plus,
    Trash2,
    Edit2,
    XCircle,
    Loader2,
    ArrowRight,
    Shield,
    Eye,
    EyeOff,
    Sun,
    Moon,
    Activity,
    CloudOff
} from "lucide-react"
import { useDataSources, PlatformType, DataSource, platformInfo } from "@/lib/context/data-sources-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { isTelemetryDisabled, enableTelemetry, disableTelemetry, STORAGE_KEY, TELEMETRY_PREFERENCE_EVENT } from "@/lib/telemetry"
import { toast } from "sonner"
import { applicationRequest, ApplicationRequestError } from '@/lib/api/application-request'

const platformIcons: Record<PlatformType, React.ReactNode> = {
    vbr: <Server className="h-6 w-6" />,
    vb365: <Cloud className="h-6 w-6" />,
    vro: <RefreshCw className="h-6 w-6" />,
    "veeam-one": <BarChart2 className="h-6 w-6" />,
    one: <BarChart2 className="h-6 w-6" />,
    kasten: <Database className="h-6 w-6" />
}

interface AuthState {
    sourceId: string
    username: string
    password: string
    loading: boolean
    error: string | null
}

// Default ports for each platform
const defaultPorts: Record<PlatformType, string> = {
    vbr: "9419",
    vb365: "4443",
    vro: "9081",
    "veeam-one": "1239",
    one: "1239",
    kasten: "443"
}

export function LandingPage() {
    const { t } = useI18n()
    const { dataSources, addDataSource, removeDataSource, updateDataSource, reloadSources, isLoading, loadError } = useDataSources()
    const [connectionError, setConnectionError] = useState<string | null>(null)
    const { theme, setTheme } = useTheme()
    const [mounted, setMounted] = useState(false)
    const [telemetryEnabled, setTelemetryEnabled] = useState(true)

    // After mounting, we have access to the theme
    useEffect(() => {
        setMounted(true)
        const sync = () => setTelemetryEnabled(!isTelemetryDisabled())
        const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === null) sync() }
        sync()
        window.addEventListener(TELEMETRY_PREFERENCE_EVENT, sync)
        window.addEventListener('storage', onStorage)
        return () => {
            window.removeEventListener(TELEMETRY_PREFERENCE_EVENT, sync)
            window.removeEventListener('storage', onStorage)
        }
    }, [])

    // UI State
    const [viewMode, setViewMode] = useState<"list" | "add">("list")
    const [authDialogOpen, setAuthDialogOpen] = useState(false)
    const [editDialogOpen, setEditDialogOpen] = useState(false)

    // Add Form State
    const [newSourceType, setNewSourceType] = useState<PlatformType>("vbr")
    const [newSourceHostname, setNewSourceHostname] = useState("")
    const [newSourcePort, setNewSourcePort] = useState(defaultPorts.vbr)
    const [newSourceName, setNewSourceName] = useState("")

    // Edit Form State
    const [editingSource, setEditingSource] = useState<DataSource | null>(null)
    const [editHostname, setEditHostname] = useState("")
    const [editPort, setEditPort] = useState("")
    const [editName, setEditName] = useState("")

    // Auth State
    const [authState, setAuthState] = useState<AuthState>({
        sourceId: "",
        username: "",
        password: "",
        loading: false,
        error: null
    })
    const [showPassword, setShowPassword] = useState(false)

    // Auto-select first available platform when switching to add mode
    useEffect(() => {
        if (viewMode === "add") {
            const available = (Object.keys(platformInfo) as PlatformType[])
                .find(type => !dataSources.some(ds => ds.type === type))

            if (available) {
                setNewSourceType(available)
            }
        }
    }, [viewMode, dataSources])

    // Update port when platform type changes
    useEffect(() => {
        setNewSourcePort(defaultPorts[newSourceType])
    }, [newSourceType])

    const handleAddSource = () => {
        if (!newSourceHostname.trim()) return

        // Construct full URL
        const hostname = newSourceHostname.trim()
            .replace(/^https?:\/\//, '') // Remove protocol if user typed it
            .replace(/\/$/, '') // Remove trailing slash

        const fullUrl = `https://${hostname}:${newSourcePort}`

        addDataSource(newSourceType, fullUrl, newSourceName.trim() || undefined)
        setNewSourceHostname("")
        setNewSourcePort(defaultPorts.vbr)
        setNewSourceName("")
        setViewMode("list")
    }

    const handleEditSource = () => {
        if (!editingSource || !editHostname.trim()) return

        const hostname = editHostname.trim()
            .replace(/^https?:\/\//, '')
            .replace(/\/$/, '')

        const fullUrl = `https://${hostname}:${editPort}`

        updateDataSource(editingSource.id, { url: fullUrl, name: editName.trim() || undefined })
        setEditingSource(null)
        setEditDialogOpen(false)
    }

    const openEditDialog = (source: DataSource) => {
        setEditingSource(source)

        try {
            const urlObj = new URL(source.url)
            setEditHostname(urlObj.hostname)
            setEditPort(urlObj.port || defaultPorts[source.type])
        } catch {
            // Fallback for malformed URLs
            setEditHostname(source.url.replace(/^https?:\/\//, '').split(':')[0])
            setEditPort(defaultPorts[source.type])
        }

        setEditName(source.name)
        setEditDialogOpen(true)
    }

    const openAuthDialog = (sourceId: string) => {
        setAuthState({
            sourceId,
            username: "",
            password: "",
            loading: false,
            error: null
        })
        setShowPassword(false)
        setAuthDialogOpen(true)
    }

    const handleAuthenticate = async () => {
        const source = dataSources.find(ds => ds.id === authState.sourceId)
        if (!source) return

        setAuthState(prev => ({ ...prev, loading: true, error: null }))

        try {
            const path = source.managed ? `/api/administration/data-sources/${encodeURIComponent(source.id)}/connect` : `/api/auth/${source.type}`
            await applicationRequest(path, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...(!source.managed ? { url: source.url } : {}),
                    username: authState.username,
                    password: authState.password
                })
            })

            await reloadSources()
            setAuthState(prev => ({ ...prev, username: '', password: '', loading: false }))
            setAuthDialogOpen(false)
        } catch (error) {
            setAuthState(prev => ({
                ...prev,
                loading: false,
                error: error instanceof Error ? error.message : "Authentication failed"
            }))
        }
    }

    const [connecting, setConnecting] = useState<Set<string>>(new Set())

    const handleAutoConnect = async (source: DataSource) => {
        setConnecting(prev => new Set(prev).add(source.id))
        setConnectionError(null)
        try {
            await applicationRequest(`/api/administration/data-sources/${encodeURIComponent(source.id)}/connect`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({})
            })

            await reloadSources()
            return true
        } catch (error) {
            if (error instanceof ApplicationRequestError && error.kind === 'response' && error.status === 401 && source.managed !== 'environment') {
                openAuthDialog(source.id)
            } else {
                setConnectionError(error instanceof Error ? error.message : 'The source could not be connected. Please retry.')
            }
            return false
        } finally {
            setConnecting(prev => {
                const next = new Set(prev)
                next.delete(source.id)
                return next
            })
        }
    }

    const handleConnectAll = async () => {
        const unauthenticated = dataSources.filter(ds => !ds.isAuthenticated)

        // Filter those with credentials for auto-connect
        const autoConnectable = unauthenticated.filter(ds => ds.hasCredentials)

        if (autoConnectable.length > 0) {
            await Promise.all(autoConnectable.map(ds => handleAutoConnect(ds)))
        }

        // If we still have unauthenticated ones (or none were auto-connectable), prompt for the first manual one
        if (autoConnectable.length === 0 && unauthenticated.length > 0) {
            openAuthDialog(unauthenticated[0].id)
        }
    }

    const allAuthenticated = dataSources.length > 0 && dataSources.every(ds => ds.isAuthenticated)

    return (
        <div className="min-h-screen flex" style={{ fontFamily: 'var(--font-manrope), sans-serif' }}>
            {/* Feature showcase */}
            <div className="hidden min-w-0 lg:flex lg:w-1/2 relative bg-[#0a151b]">
                <FeatureCarousel />
            </div>
            {/* Right Form Section (Moved from Left to Right) */}
            <div className="flex-1 flex flex-col justify-center px-8 lg:px-16 py-12 bg-background relative z-10 overflow-hidden">

                {/* Top Right Controls */}
                <div className="absolute top-8 right-8 z-20 flex items-center gap-3">
                    {mounted && (
                        <>
                            {/* Telemetry Toggle */}
                            <div className="border rounded-lg p-1 flex items-center gap-1 bg-background/50 backdrop-blur-sm" title={t("Telemetry Settings")}>
                                <button
                                    onClick={() => {
                                        if (!enableTelemetry()) toast.error('The telemetry preference could not be saved in this browser.')
                                    }}
                                    title={t("Telemetry Enabled")}
                                    className={cn(
                                        "p-1.5 rounded-md transition-all",
                                        telemetryEnabled ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    <Activity className="h-4 w-4" />
                                    <span className="sr-only">{t("Enable Telemetry")}</span>
                                </button>
                                <button
                                    onClick={() => {
                                        if (!disableTelemetry()) toast.error('The telemetry preference could not be saved in this browser.')
                                    }}
                                    title={t("Telemetry Disabled")}
                                    className={cn(
                                        "p-1.5 rounded-md transition-all",
                                        !telemetryEnabled ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    <CloudOff className="h-4 w-4" />
                                    <span className="sr-only">{t("Disable Telemetry")}</span>
                                </button>
                            </div>

                            {/* Theme Toggle */}
                            <div className="border rounded-lg p-1 flex items-center gap-1 bg-background/50 backdrop-blur-sm">
                                <button
                                    onClick={() => setTheme("light")}
                                    className={cn(
                                        "p-1.5 rounded-md transition-all",
                                        theme === "light" ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    <Sun className="h-4 w-4" />
                                    <span className="sr-only">{t("Light Mode")}</span>
                                </button>
                                <button
                                    onClick={() => setTheme("dark")}
                                    className={cn(
                                        "p-1.5 rounded-md transition-all",
                                        theme === "dark" ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    <Moon className="h-4 w-4" />
                                    <span className="sr-only">{t("Dark Mode")}</span>
                                </button>
                            </div>
                        </>
                    )}
                </div>

                <div className="max-w-lg mx-auto w-full relative min-h-[500px]">

                    {/* LIST VIEW */}
                    <div className={cn(
                        "transition-all duration-500 ease-in-out absolute inset-0 flex flex-col",
                        viewMode === "list" ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-full pointer-events-none"
                    )}>
                        {/* Header Row */}
                        <div className="flex items-center gap-3 mb-6 pt-4">
                            <Shield className="h-7 w-7 text-[#00b336]" />
                            <span className="text-lg font-bold">Open Backup UI</span>
                        </div>

                        {/* Title + Actions Row */}
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h2 className="text-2xl font-bold">
                                    {t(dataSources.length === 0 && !isLoading && !loadError ? "Get Started" : "Data Sources")}
                                </h2>
                                <p className="text-sm text-muted-foreground">
                                    {dataSources.length === 0 && !isLoading && !loadError
                                        ? t("Add your first data source to begin")
                                        : t("Connections run from the application server, including when you use your phone.")
                                    }
                                </p>
                            </div>
                            {dataSources.length > 0 && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setViewMode("add")}
                                    className="shrink-0"
                                >
                                    <Plus className="h-4 w-4 mr-1" />{t("Add")}</Button>
                            )}
                        </div>

                        {(loadError || connectionError) && <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
                            <p>{loadError || connectionError}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                <Button variant="outline" size="sm" disabled={isLoading} onClick={() => { setConnectionError(null); void reloadSources() }}>{t("Retry")}</Button>
                                <Button variant="outline" size="sm" onClick={() => {
                                    const url = new URL(window.location.href)
                                    if (url.hostname.endsWith('.trycloudflare.com')) url.protocol = 'https:'
                                    window.location.assign(url.href)
                                }}>{t("Reopen secure connection")}</Button>
                            </div>
                        </div>}
                        {isLoading && <p role="status" className="mb-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>{t("Loading saved connections…")}</p>}
                        {/* Scrollable Sources Grid */}
                        <div className="flex-1 min-h-0 overflow-y-auto pr-1 -mr-1">
                            <div className="space-y-3">
                                {dataSources.map((source) => (
                                    <div
                                        key={source.id}
                                        className={cn(
                                            "group relative p-3 rounded-lg border transition-all",
                                            "bg-card hover:bg-accent/50",
                                            source.isAuthenticated && "border-[#00b336]/30 bg-[#00b336]/5"
                                        )}
                                    >
                                        <div className="flex items-center gap-3">
                                            {/* Icon */}
                                            <div
                                                className="p-2 rounded-md shrink-0"
                                                style={{ backgroundColor: `${platformInfo[source.type].color}20` }}
                                            >
                                                <div style={{ color: platformInfo[source.type].color }} className="[&>svg]:h-5 [&>svg]:w-5">
                                                    {platformIcons[source.type]}
                                                </div>
                                            </div>

                                            {/* Info */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium text-sm truncate">{source.name}</span>
                                                    {source.isAuthenticated ? (
                                                        <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5 bg-green-500/10 text-green-500 hover:bg-green-500/20 border-green-500/20">{t("Connected")}</Badge>
                                                    ) : (
                                                        <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-amber-500/20">
                                                            {t(source.hasCredentials ? "Ready" : "Setup")}
                                                        </Badge>
                                                    )}
                                                </div>
                                                <p className="text-xs text-muted-foreground truncate">
                                                    {platformInfo[source.type].name}
                                                </p>
                                            </div>

                                            {/* Actions */}
                                            <div className="flex items-center gap-1 shrink-0">
                                                {!source.isAuthenticated && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7 px-2 text-xs"
                                                        onClick={() => source.hasCredentials ? handleAutoConnect(source) : openAuthDialog(source.id)}
                                                        disabled={connecting.has(source.id) || isLoading || !!loadError}
                                                    >
                                                        {connecting.has(source.id) ? (
                                                            <Loader2 className="h-3 w-3 animate-spin" />
                                                        ) : (
                                                            t(source.hasCredentials ? "Connect" : "Setup")
                                                        )}
                                                    </Button>
                                                )}
                                                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7"
                                                        onClick={() => openEditDialog(source)}
                                                    >
                                                        <Edit2 className="h-3 w-3" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7 text-destructive"
                                                        onClick={() => removeDataSource(source.id)}
                                                    >
                                                        <Trash2 className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}

                                {/* Empty State - Add Source */}
                                {dataSources.length === 0 && !isLoading && !loadError && (
                                    <button
                                        onClick={() => setViewMode("add")}
                                        className={cn(
                                            "w-full p-6 rounded-xl border-2 border-dashed transition-all",
                                            "flex flex-col items-center justify-center gap-2",
                                            "text-muted-foreground hover:text-foreground",
                                            "hover:border-[#00b336] hover:bg-[#00b336]/5"
                                        )}
                                    >
                                        <Plus className="h-8 w-8" />
                                        <span className="font-medium">{t("Add Your First Data Source")}</span>
                                        <span className="text-xs">{t("Connect VBR, VB365, Veeam ONE, or more")}</span>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Footer - Connect Button */}
                        {dataSources.length > 0 && (
                            <div className="pt-4 mt-auto border-t">
                                <Button
                                    size="default"
                                    className="w-full bg-[#00b336] hover:bg-[#00a030] text-white"
                                    onClick={allAuthenticated ? () => window.location.href = "/dashboard" : handleConnectAll}
                                    disabled={isLoading || !!loadError || connecting.size > 0}
                                >
                                    {allAuthenticated ? (
                                        <>{t("Continue to Dashboard")}<ArrowRight className="ml-2 h-4 w-4" />
                                        </>
                                    ) : (
                                        <>{t("Connect All Sources")}<ArrowRight className="ml-2 h-4 w-4" />
                                        </>
                                    )}
                                </Button>

                            </div>
                        )}
                    </div>

                    {/* ADD VIEW (Smooth Inline Transition) */}
                    <div className={cn(
                        "transition-all duration-500 ease-in-out absolute inset-0 flex flex-col justify-center",
                        viewMode === "add" ? "opacity-100 translate-x-0" : "opacity-0 translate-x-full pointer-events-none"
                    )}>
                        <div className="mb-8">
                            <button
                                onClick={() => setViewMode("list")}
                                className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm mb-6 transition-colors"
                            >
                                <ArrowRight className="h-4 w-4 rotate-180" />{t("Back to list")}</button>
                            <h2 className="text-3xl font-bold mb-2">{t("Add Data Source")}</h2>
                            <p className="text-muted-foreground">{t("Connect a new Veeam platform to your console.")}</p>
                        </div>

                        <div className="space-y-6">
                            <div className="space-y-2">
                                <Label>{t("Platform Type")}</Label>
                                <div className="grid grid-cols-1 gap-3">
                                    <Select value={newSourceType} onValueChange={(v) => setNewSourceType(v as PlatformType)}>
                                        <SelectTrigger className="h-12">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {(Object.keys(platformInfo) as PlatformType[])
                                                .filter(type => type !== 'one') // Exclude alias
                                                .map((type) => {
                                                    const isConfigured = dataSources.some(ds => ds.type === type || (type === 'veeam-one' && ds.type === 'one'))
                                                    return (
                                                        <SelectItem key={type} value={type} disabled={isConfigured}>
                                                            <div className="flex items-center gap-2">
                                                                <span style={{ color: platformInfo[type].color }}>
                                                                    {platformIcons[type]}
                                                                </span>
                                                                <span>
                                                                    {platformInfo[type].name}
                                                                    {isConfigured && ` (${t("Configured")})`}
                                                                </span>
                                                            </div>
                                                        </SelectItem>
                                                    )
                                                })}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>{t("Server Address")}</Label>
                                <div className="flex gap-2">
                                    <div className="flex-1 relative">
                                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium z-10 pointer-events-none">
                                            https://
                                        </div>
                                        <Input
                                            className="h-12 pl-[4.5rem]"
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
                                    <div className="w-24 relative">
                                        <Input
                                            type="number"
                                            className="h-12 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            placeholder={defaultPorts[newSourceType]}
                                            value={newSourcePort}
                                            onChange={(e) => setNewSourcePort(e.target.value)}
                                        />
                                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col gap-0.5">
                                            <button
                                                onClick={() => setNewSourcePort(p => String(Number(p) + 1))}
                                                className="p-0.5 hover:bg-accent rounded text-muted-foreground"
                                            >
                                                <ArrowRight className="h-2 w-2 -rotate-90" />
                                            </button>
                                            <button
                                                onClick={() => setNewSourcePort(p => String(Number(p) - 1))}
                                                className="p-0.5 hover:bg-accent rounded text-muted-foreground"
                                            >
                                                <ArrowRight className="h-2 w-2 rotate-90" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <p className="text-xs text-muted-foreground">{t("Hostname/IP and Port.")}</p>
                            </div>

                            <div className="space-y-2">
                                <Label>{t("Display Name (Optional)")}</Label>
                                <Input
                                    className="h-12"
                                    placeholder={platformInfo[newSourceType].name}
                                    value={newSourceName}
                                    onChange={(e) => setNewSourceName(e.target.value)}
                                />
                            </div>

                            <Button
                                onClick={handleAddSource}
                                disabled={!newSourceHostname.trim()}
                                className="w-full h-12 bg-[#00b336] hover:bg-[#00a030] text-lg font-medium"
                            >{t("Add Source")}</Button>
                        </div>
                    </div>

                </div>

                {/* Footer */}
                <div className="mt-12 text-center">
                    <p className="text-xs text-muted-foreground">{t("Made by Jorge de la Cruz, MIT License. Built for the Community with")}<span className="text-red-500">❤️</span>
                    </p>
                </div>
            </div>

            {/* Edit Dialog (Modal) */}
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t("Edit Data Source")}</DialogTitle>
                        <DialogDescription>{t("Update the connection details for this platform.")}</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>{t("Server Address")}</Label>
                            <div className="flex gap-2">
                                <div className="flex-1 relative">
                                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium z-10 pointer-events-none">
                                        https://
                                    </div>
                                    <Input
                                        className="h-12 pl-[4.5rem]"
                                        value={editHostname}
                                        onChange={(e) => setEditHostname(e.target.value)}
                                    />
                                </div>
                                <div className="w-24 relative">
                                    <Input
                                        type="number"
                                        className="h-12 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        value={editPort}
                                        onChange={(e) => setEditPort(e.target.value)}
                                    />
                                    <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col gap-0.5">
                                        <button
                                            onClick={() => setEditPort(p => String(Number(p) + 1))}
                                            className="p-0.5 hover:bg-accent rounded text-muted-foreground"
                                        >
                                            <ArrowRight className="h-2 w-2 -rotate-90" />
                                        </button>
                                        <button
                                            onClick={() => setEditPort(p => String(Number(p) - 1))}
                                            className="p-0.5 hover:bg-accent rounded text-muted-foreground"
                                        >
                                            <ArrowRight className="h-2 w-2 rotate-90" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>{t("Display Name")}</Label>
                            <Input
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditDialogOpen(false)}>{t("Cancel")}</Button>
                        <Button onClick={handleEditSource} disabled={!editHostname.trim()}>{t("Save Changes")}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Auth Dialog (Modal) */}
            <Dialog open={authDialogOpen} onOpenChange={setAuthDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t("Connect to {name}", { name: dataSources.find(ds => ds.id === authState.sourceId)?.name || "" })}</DialogTitle>
                        <DialogDescription>{t("The application server connects to this system. Your phone does not need access to its private network.")}</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        {authState.error && (
                            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-center gap-2 text-destructive text-sm">
                                <XCircle className="h-4 w-4" />
                                {authState.error}
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label>{t("Username")}</Label>
                            <Input
                                placeholder={t("domain\\\\username or username")}
                                value={authState.username}
                                onChange={(e) => setAuthState(prev => ({ ...prev, username: e.target.value }))}
                                disabled={authState.loading}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>{t("Password")}</Label>
                            <div className="relative">
                                <Input
                                    type={showPassword ? "text" : "password"}
                                    value={authState.password}
                                    onChange={(e) => setAuthState(prev => ({ ...prev, password: e.target.value }))}
                                    disabled={authState.loading}
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
                        <Button variant="outline" onClick={() => setAuthDialogOpen(false)} disabled={authState.loading}>{t("Cancel")}</Button>
                        <Button
                            onClick={handleAuthenticate}
                            disabled={authState.loading || !authState.username || !authState.password}
                            className="bg-[#00b336] hover:bg-[#00a030]"
                        >
                            {authState.loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("Connecting...")}</>
                            ) : (
                                t("Connect")
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
