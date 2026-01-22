"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useTheme } from "next-themes"
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
    LayoutGrid,
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
import { isTelemetryDisabled, enableTelemetry, disableTelemetry } from "@/lib/telemetry"
import posthog from "posthog-js"

const platformIcons: Record<PlatformType, React.ReactNode> = {
    vbr: <Server className="h-6 w-6" />,
    vb365: <Cloud className="h-6 w-6" />,
    vro: <RefreshCw className="h-6 w-6" />,
    "veeam-one": <BarChart2 className="h-6 w-6" />,
    one: <BarChart2 className="h-6 w-6" />,
    kasten: <Database className="h-6 w-6" />
}

const featureSlides = [
    {
        title: "Unified Visibility",
        description: "Gain comprehensive insights across your entire Veeam data protection ecosystem from a single, intuitive dashboard.",
        icon: <LayoutGrid className="h-5 w-5" />,
        imagePlaceholder: "/images/slide-1.png",
        gradient: "from-[#0a1015] via-[#0d1820] to-[#002a11]" // Deep Green
    },
    {
        title: "Centralized Management",
        description: "Connect and manage multiple Veeam Backup & Replication, Veeam ONE, and VB365 instances seamlessly.",
        icon: <Server className="h-5 w-5" />,
        imagePlaceholder: "/images/slide-2.png",
        gradient: "from-[#0a1015] via-[#0d1820] to-[#001a33]" // Deep Blue
    },
    {
        title: "Advanced Analytics",
        description: "Leverage powerful analytics and reporting tools to optimize your data protection strategy and ensure compliance.",
        icon: <BarChart2 className="h-5 w-5" />,
        imagePlaceholder: "/images/slide-3.png",
        gradient: "from-[#0a1015] via-[#1a0b1a] to-[#2a0d00]" // Deep Amber/Purple
    }
]

interface AuthState {
    sourceId: string
    username: string
    password: string
    loading: boolean
    error: string | null
}

// Canvas-based particle system
function ParticleCanvas() {
    const canvasRef = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        let animationId: number
        let particles: Array<{
            x: number
            y: number
            vx: number
            vy: number
            size: number
            opacity: number
            hue: number
        }> = []

        const resize = () => {
            canvas.width = canvas.offsetWidth * window.devicePixelRatio
            canvas.height = canvas.offsetHeight * window.devicePixelRatio
            ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
        }

        const createParticles = () => {
            const count = 50
            particles = []
            for (let i = 0; i < count; i++) {
                particles.push({
                    x: Math.random() * canvas.offsetWidth,
                    y: Math.random() * canvas.offsetHeight,
                    vx: (Math.random() - 0.5) * 0.4,
                    vy: (Math.random() - 0.5) * 0.4,
                    size: Math.random() * 2 + 1,
                    opacity: Math.random() * 0.4 + 0.1,
                    hue: Math.random() * 40 + 160 // Teal-cyan range
                })
            }
        }

        const drawConnections = () => {
            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x
                    const dy = particles[i].y - particles[j].y
                    const dist = Math.sqrt(dx * dx + dy * dy)

                    if (dist < 100) {
                        const opacity = (1 - dist / 100) * 0.1
                        ctx.beginPath()
                        ctx.strokeStyle = `rgba(0, 179, 54, ${opacity})`
                        ctx.lineWidth = 0.5
                        ctx.moveTo(particles[i].x, particles[i].y)
                        ctx.lineTo(particles[j].x, particles[j].y)
                        ctx.stroke()
                    }
                }
            }
        }

        const animate = () => {
            ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)

            particles.forEach(p => {
                p.x += p.vx
                p.y += p.vy

                if (p.x < 0) p.x = canvas.offsetWidth
                if (p.x > canvas.offsetWidth) p.x = 0
                if (p.y < 0) p.y = canvas.offsetHeight
                if (p.y > canvas.offsetHeight) p.y = 0

                ctx.beginPath()
                const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3)
                gradient.addColorStop(0, `hsla(${p.hue}, 70%, 50%, ${p.opacity})`)
                gradient.addColorStop(1, `hsla(${p.hue}, 70%, 50%, 0)`)
                ctx.fillStyle = gradient
                ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2)
                ctx.fill()

                ctx.beginPath()
                ctx.fillStyle = `hsla(${p.hue}, 70%, 60%, ${p.opacity * 1.5})`
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
                ctx.fill()
            })

            drawConnections()
            animationId = requestAnimationFrame(animate)
        }

        resize()
        createParticles()
        animate()

        window.addEventListener('resize', () => {
            resize()
            createParticles()
        })

        return () => {
            cancelAnimationFrame(animationId)
        }
    }, [])

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{ opacity: 0.5 }}
        />
    )
}

// Full-page feature carousel with tabbed navigation
function FeatureCarousel() {
    const [currentSlide, setCurrentSlide] = useState(0)
    const [isAutoPlaying, setIsAutoPlaying] = useState(true)
    const SLIDE_DURATION = 8000

    const goToSlide = useCallback((index: number) => {
        setCurrentSlide(index)
        setIsAutoPlaying(false) // Stop auto-play on interaction
    }, [])

    useEffect(() => {
        if (!isAutoPlaying) return

        const interval = setInterval(() => {
            setCurrentSlide(curr => (curr + 1) % featureSlides.length)
        }, SLIDE_DURATION)

        return () => clearInterval(interval)
    }, [isAutoPlaying])

    const slide = featureSlides[currentSlide]

    return (
        <div className="relative h-full flex flex-col pt-20 pb-12 overflow-hidden px-8 transition-colors duration-1000">
            {/* Dynamic Background Layer */}
            <div
                className={cn(
                    "absolute inset-0 transition-opacity duration-1000 bg-gradient-to-br opacity-100",
                    slide.gradient
                )}
            />

            {/* Content Container */}
            <div className="relative z-10 flex-1 flex flex-col">

                {/* Text Area - Top */}
                <div className="text-center mb-12 max-w-2xl mx-auto">
                    <h2 className="text-4xl lg:text-5xl font-bold text-white mb-6 tracking-tight leading-tight">
                        {slide.title}
                    </h2>
                    <p className="text-lg text-slate-400 leading-relaxed">
                        {slide.description}
                    </p>
                </div>

                {/* Main Visual - Larger Scale (Middle) */}
                <div className="flex-1 relative flex items-center justify-center mb-12">
                    <div className="relative w-full max-w-2xl aspect-video bg-[#0b1219] rounded-xl border border-white/10 shadow-[0_30px_60px_rgba(0,0,0,0.6)] p-6 backdrop-blur-sm transition-all duration-700 ease-in-out transform hover:scale-[1.02] flex flex-col overflow-hidden">

                        {/* Mock UI Header */}
                        <div className="flex items-center gap-2 mb-6 border-b border-white/5 pb-4">
                            <div className="flex gap-1.5">
                                <div className="w-2.5 h-2.5 rounded-full bg-red-500/20 opacity-50" />
                                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20 opacity-50" />
                                <div className="w-2.5 h-2.5 rounded-full bg-green-500/20 opacity-50" />
                            </div>
                            <div className="h-4 w-32 bg-white/5 rounded ml-4" />
                        </div>

                        {/* Dynamic Visualization Content based on slide */}
                        <div className="w-full h-full p-0 flex items-center justify-center overflow-hidden bg-black/20">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={slide.imagePlaceholder}
                                alt={slide.title}
                                className="w-full h-full object-cover opacity-90 transition-opacity hover:opacity-100"
                            />
                        </div>

                        {/* Overlay Badge */}
                        <div className="absolute bottom-6 right-6">
                            <Badge variant="outline" className="bg-black/50 backdrop-blur-md border-white/10 text-white/70">
                                {slide.title} Preview
                            </Badge>
                        </div>
                    </div>
                </div>

                {/* Tab Navigation (Pill Buttons) - Bottom */}
                <div className="flex justify-center items-center gap-3">
                    {featureSlides.map((s, idx) => {
                        const isActive = idx === currentSlide
                        return (
                            <button
                                key={idx}
                                onClick={() => goToSlide(idx)}
                                className={cn(
                                    "px-6 py-2.5 rounded-full text-sm font-medium transition-all duration-300 flex items-center gap-2.5 border",
                                    isActive
                                        ? "bg-white/90 text-black border-white shadow-[0_0_20px_rgba(255,255,255,0.3)] scale-105"
                                        : "bg-white/5 text-white/70 border-white/10 hover:bg-white/10 hover:border-white/20 hover:text-white backdrop-blur-md"
                                )}
                            >
                                <span className={cn("transition-colors", isActive ? "text-black" : "text-white/70")}>{s.icon}</span>
                                <span>{s.title}</span>
                            </button>
                        )
                    })}
                </div>
            </div>
        </div>
    )
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
    const { dataSources, addDataSource, removeDataSource, updateDataSource, setAuthenticated } = useDataSources()
    const { theme, setTheme } = useTheme()
    const [mounted, setMounted] = useState(false)
    const [telemetryEnabled, setTelemetryEnabled] = useState(true)

    // After mounting, we have access to the theme
    useEffect(() => {
        setMounted(true)
        setTelemetryEnabled(!isTelemetryDisabled())
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
            const response = await fetch(`/api/auth/${source.type}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    url: source.url,
                    username: authState.username,
                    password: authState.password
                })
            })

            if (!response.ok) {
                const data = await response.json()
                throw new Error(data.error || "Authentication failed")
            }

            setAuthenticated(authState.sourceId, true)
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
        try {
            const response = await fetch(`/api/auth/${source.type}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sourceId: source.id })
            })

            if (response.ok) {
                setAuthenticated(source.id, true)
                return true
            } else {
                openAuthDialog(source.id)
                return false
            }
        } catch {
            openAuthDialog(source.id)
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
            {/* Left Carousel Section (Moved from Right to Left) */}
            <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-[#0a1015] via-[#0d1820] to-[#0a1a1a]">
                <ParticleCanvas />

                <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-0 left-0 w-full h-24 bg-gradient-to-b from-[#0a1015] to-transparent" />
                    <div className="absolute bottom-0 left-0 w-full h-24 bg-gradient-to-t from-[#0a1015] to-transparent" />
                </div>

                <div className="relative z-10 w-full h-full">
                    <FeatureCarousel />
                </div>
            </div>

            {/* Right Form Section (Moved from Left to Right) */}
            <div className="flex-1 flex flex-col justify-center px-8 lg:px-16 py-12 bg-background relative z-10 overflow-hidden">

                {/* Top Right Controls */}
                <div className="absolute top-8 right-8 z-20 flex items-center gap-3">
                    {mounted && (
                        <>
                            {/* Telemetry Toggle */}
                            <div className="border rounded-lg p-1 flex items-center gap-1 bg-background/50 backdrop-blur-sm" title="Telemetry Settings">
                                <button
                                    onClick={() => {
                                        enableTelemetry()
                                        setTelemetryEnabled(true)
                                        if (posthog) posthog.opt_in_capturing()
                                    }}
                                    title="Telemetry Enabled"
                                    className={cn(
                                        "p-1.5 rounded-md transition-all",
                                        telemetryEnabled ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    <Activity className="h-4 w-4" />
                                    <span className="sr-only">Enable Telemetry</span>
                                </button>
                                <button
                                    onClick={() => {
                                        disableTelemetry()
                                        setTelemetryEnabled(false)
                                        if (posthog) posthog.opt_out_capturing()
                                    }}
                                    title="Telemetry Disabled"
                                    className={cn(
                                        "p-1.5 rounded-md transition-all",
                                        !telemetryEnabled ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    <CloudOff className="h-4 w-4" />
                                    <span className="sr-only">Disable Telemetry</span>
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
                                    <span className="sr-only">Light Mode</span>
                                </button>
                                <button
                                    onClick={() => setTheme("dark")}
                                    className={cn(
                                        "p-1.5 rounded-md transition-all",
                                        theme === "dark" ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    <Moon className="h-4 w-4" />
                                    <span className="sr-only">Dark Mode</span>
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
                                    {dataSources.length === 0 ? "Get Started" : "Data Sources"}
                                </h2>
                                <p className="text-sm text-muted-foreground">
                                    {dataSources.length === 0
                                        ? "Add your first data source to begin"
                                        : "Manage your connected platforms"
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
                                    <Plus className="h-4 w-4 mr-1" />
                                    Add
                                </Button>
                            )}
                        </div>

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
                                                        <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5 bg-green-500/10 text-green-500 hover:bg-green-500/20 border-green-500/20">
                                                            Connected
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-amber-500/20">
                                                            {source.hasCredentials ? "Ready" : "Setup"}
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
                                                        disabled={connecting.has(source.id)}
                                                    >
                                                        {connecting.has(source.id) ? (
                                                            <Loader2 className="h-3 w-3 animate-spin" />
                                                        ) : (
                                                            source.hasCredentials ? "Connect" : "Setup"
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
                                {dataSources.length === 0 && (
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
                                        <span className="font-medium">Add Your First Data Source</span>
                                        <span className="text-xs">Connect VBR, VB365, Veeam ONE, or more</span>
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
                                >
                                    {allAuthenticated ? (
                                        <>
                                            Continue to Dashboard
                                            <ArrowRight className="ml-2 h-4 w-4" />
                                        </>
                                    ) : (
                                        <>
                                            Connect All Sources
                                            <ArrowRight className="ml-2 h-4 w-4" />
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
                                <ArrowRight className="h-4 w-4 rotate-180" />
                                Back to list
                            </button>
                            <h2 className="text-3xl font-bold mb-2">Add Data Source</h2>
                            <p className="text-muted-foreground">
                                Connect a new Veeam platform to your console.
                            </p>
                        </div>

                        <div className="space-y-6">
                            <div className="space-y-2">
                                <Label>Platform Type</Label>
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
                                                                    {isConfigured && " (Configured)"}
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
                                <Label>Server Address</Label>
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
                                <p className="text-xs text-muted-foreground">
                                    Hostname/IP and Port.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label>Display Name (Optional)</Label>
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
                            >
                                Add Source
                            </Button>
                        </div>
                    </div>

                </div>

                {/* Footer */}
                <div className="mt-12 text-center">
                    <p className="text-xs text-muted-foreground">
                        Made by Jorge de la Cruz, MIT License. Built for the Community with <span className="text-red-500">❤️</span>
                    </p>
                </div>
            </div>

            {/* Edit Dialog (Modal) */}
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Edit Data Source</DialogTitle>
                        <DialogDescription>
                            Update the connection details for this platform.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Server Address</Label>
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
                        <Button onClick={handleEditSource} disabled={!editHostname.trim()}>
                            Save Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Auth Dialog (Modal) */}
            <Dialog open={authDialogOpen} onOpenChange={setAuthDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Connect to {dataSources.find(ds => ds.id === authState.sourceId)?.name}</DialogTitle>
                        <DialogDescription>
                            Enter your credentials to authenticate.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        {authState.error && (
                            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-center gap-2 text-destructive text-sm">
                                <XCircle className="h-4 w-4" />
                                {authState.error}
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label>Username</Label>
                            <Input
                                placeholder="domain\\username or username"
                                value={authState.username}
                                onChange={(e) => setAuthState(prev => ({ ...prev, username: e.target.value }))}
                                disabled={authState.loading}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Password</Label>
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
                        <Button variant="outline" onClick={() => setAuthDialogOpen(false)} disabled={authState.loading}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleAuthenticate}
                            disabled={authState.loading || !authState.username || !authState.password}
                            className="bg-[#00b336] hover:bg-[#00a030]"
                        >
                            {authState.loading ? (
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
        </div>
    )
}
