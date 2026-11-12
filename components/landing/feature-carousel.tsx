"use client"
// Open Backup UI v1.2.0

import { useI18n } from "@/components/providers/i18n-provider"

import { useEffect, useState } from "react"
import Image from "next/image"
import { ArrowLeft, ArrowRight, Cloud, Hexagon, Languages, LayoutGrid, ListChecks, Palette, Pause, Play, TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"
import protectionLens from "@/public/images/connect/protection-lens.webp"
import capacityForecast from "@/public/images/connect/capacity-forecast.webp"
import protectionHexMap from "@/public/images/connect/protection-hexmap.webp"
import jobBuilder from "@/public/images/connect/job-builder.webp"
import microsoft365 from "@/public/images/connect/microsoft-365.webp"
import themeOcean from "@/public/images/connect/theme-ocean.webp"
import themeForest from "@/public/images/connect/theme-forest.webp"
import themeAurora from "@/public/images/connect/theme-aurora.webp"
import localizationSpanish from "@/public/images/connect/localization-spanish.webp"

const featureSlides = [
    {
        id: "protection-lens",
        image: protectionLens,
        label: "Protection Lens",
        title: "See what needs attention",
        description: "Review job health, backup activity, and repository pressure through four focused Protection Lens views.",
        alt: "Protection Lens overview showing job health, backup activity, and repository capacity.",
        icon: LayoutGrid,
    },
    {
        id: "capacity-forecast",
        image: capacityForecast,
        label: "Capacity Forecast",
        title: "Plan for tomorrow’s storage",
        description: "Explore retained backup growth and compare retention scenarios alongside recorded repository capacity.",
        alt: "Capacity Forecast chart comparing retained backup history with a projected footprint, with a legend and an explanation of the evidence.",
        icon: TrendingUp,
    },
    {
        id: "protection-hexmap",
        image: protectionHexMap,
        label: "Protection HexMap",
        title: "Spot recovery gaps at a glance",
        description: "Scan workload recovery age in the HexMap, then investigate restore points and backup coverage.",
        alt: "Protection HexMap with named workloads colored by recovery age and available restore points.",
        icon: Hexagon,
    },
    {
        id: "job-builder",
        image: jobBuilder,
        label: "Job Builder",
        title: "Build protection plans with confidence",
        description: "Create VMware and Hyper-V backup jobs in four steps, with reusable retention, guest-processing, and schedule profiles.",
        alt: "Backup job builder on the Policies stage, with retention, guest-processing, and schedule profiles alongside the four-step navigation and protection plan summary.",
        icon: ListChecks,
    },
    {
        id: "microsoft-365",
        image: microsoft365,
        label: "Microsoft 365",
        title: "Bring Microsoft 365 into focus",
        description: "Review backup jobs, protected objects, organizations, and storage health in one Operations experience.",
        alt: "Microsoft 365 Operations dashboard showing backup job health, protected objects, and repository headroom.",
        icon: Cloud,
    },
    {
        id: "theme-ocean",
        image: themeOcean,
        label: "Themes",
        title: "Your console, your style",
        description: "Choose Operations or Glass Ocean, Forest, and Aurora themes, with light and dark modes and live previews.",
        alt: "Branding and Appearance showing the Glass Ocean theme and its live Operations preview.",
        icon: Palette,
    },
    {
        id: "theme-forest",
        image: themeForest,
        label: "Glass Forest",
        title: "A calmer view of your operations",
        description: "Use emerald and teal surfaces with the Glass Forest theme, alongside your preferred fonts, colors, and layout.",
        alt: "Branding and Appearance showing the Glass Forest theme and its live Operations preview.",
        icon: Palette,
    },
    {
        id: "theme-aurora",
        image: themeAurora,
        label: "Glass Aurora",
        title: "Add color to everyday operations",
        description: "Apply violet and rose accents with Glass Aurora while keeping status and result colors consistent.",
        alt: "Branding and Appearance showing the Glass Aurora theme and its live Operations preview.",
        icon: Palette,
    },
    {
        id: "localization",
        image: localizationSpanish,
        label: "Languages",
        title: "Work in your language",
        description: "Choose from 11 languages for supported workspaces, with localized status labels, dates, numbers, and guidance.",
        alt: "Protection Lens overview in Spanish with localized metrics, next-step guidance, and navigation.",
        icon: Languages,
    },
] as const

const SLIDE_DURATION = 8000
const controlClassName = "inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-slate-200 transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a151b] motion-reduce:transition-none"

export function FeatureCarousel() {
    const { t } = useI18n()
    const [currentSlide, setCurrentSlide] = useState(0)
    const [isAutoPlaying, setIsAutoPlaying] = useState(false)
    const [isDesktop, setIsDesktop] = useState(false)
    const [isPageVisible, setIsPageVisible] = useState(false)
    const [isHovered, setIsHovered] = useState(false)

    useEffect(() => {
        const desktop = window.matchMedia("(min-width: 1024px)")
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
        const syncDesktop = () => setIsDesktop(desktop.matches)
        const syncVisibility = () => setIsPageVisible(!document.hidden)
        const syncReducedMotion = () => {
            if (reducedMotion.matches) setIsAutoPlaying(false)
        }

        syncDesktop()
        syncVisibility()
        setIsAutoPlaying(!reducedMotion.matches)
        desktop.addEventListener("change", syncDesktop)
        reducedMotion.addEventListener("change", syncReducedMotion)
        document.addEventListener("visibilitychange", syncVisibility)

        return () => {
            desktop.removeEventListener("change", syncDesktop)
            reducedMotion.removeEventListener("change", syncReducedMotion)
            document.removeEventListener("visibilitychange", syncVisibility)
        }
    }, [])

    const isRotating = isAutoPlaying && isDesktop && isPageVisible && !isHovered

    useEffect(() => {
        if (!isRotating) return

        const timeout = window.setTimeout(() => {
            setCurrentSlide(index => (index + 1) % featureSlides.length)
        }, SLIDE_DURATION)

        return () => window.clearTimeout(timeout)
    }, [currentSlide, isRotating])

    const goToSlide = (index: number) => {
        setCurrentSlide((index + featureSlides.length) % featureSlides.length)
        setIsAutoPlaying(false)
    }

    const slide = featureSlides[currentSlide]

    return (
        <section
            aria-label={t("Explore Open Backup UI features")}
            aria-roledescription="carousel"
            className="relative flex h-full min-h-screen w-full flex-col justify-center overflow-hidden px-6 py-6 xl:px-10 2xl:px-14"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onFocusCapture={event => {
                if (
                    event.target instanceof HTMLElement &&
                    event.target.matches(":focus-visible") &&
                    !event.currentTarget.contains(event.relatedTarget as Node | null)
                ) {
                    setIsAutoPlaying(false)
                }
            }}
        >
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_12%_10%,rgba(16,185,129,0.16),transparent_55%),radial-gradient(ellipse_at_95%_85%,rgba(56,189,248,0.10),transparent_55%),linear-gradient(145deg,#0a151b,#091117_60%,#0b2023)]" />
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-emerald-200/15 to-transparent" />

            <div className="relative mx-auto w-full max-w-5xl">
                <div className="mb-3 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-300/90">
                    <span className="h-px w-7 bg-emerald-300/60" aria-hidden="true" />{t("Explore Open Backup UI")}</div>

                <div id="connect-feature-slide" aria-live={isRotating ? "off" : "polite"} aria-atomic="true">
                    <div role="group" aria-roledescription="slide" aria-label={t("{current} of {total}: {feature}", { current: currentSlide + 1, total: featureSlides.length, feature: t(slide.label) })}>
                        <div className="min-h-32 pb-4">
                            <h2 className="max-w-xl text-[clamp(1.75rem,2.2vw,2.5rem)] font-semibold leading-[1.12] tracking-tight text-white">
                                {t(slide.title)}
                            </h2>
                            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">
                                {t(slide.description)}
                            </p>
                        </div>

                        <div className="relative aspect-video max-h-[38vh] w-full overflow-hidden rounded-xl border border-white/15 bg-[#101315] shadow-[0_24px_70px_-18px_rgba(0,0,0,0.7),0_0_45px_-20px_rgba(16,185,129,0.2)]">
                            {isDesktop && (
                                <Image
                                    key={slide.id}
                                    src={slide.image}
                                    alt={t(slide.alt)}
                                    fill
                                    sizes="(min-width: 1024px) 50vw, 1px"
                                    priority
                                    className="object-contain"
                                />
                            )}
                        </div>
                    </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2" role="group" aria-label={t("Choose a feature")}>
                    {featureSlides.map((feature, index) => {
                        const Icon = feature.icon
                        const selected = index === currentSlide

                        return (
                            <button
                                key={feature.id}
                                type="button"
                                aria-pressed={selected}
                                aria-controls="connect-feature-slide"
                                onClick={() => goToSlide(index)}
                                className={cn(
                                    "flex min-h-12 items-center justify-center gap-2 rounded-lg border px-2 py-2.5 text-center text-[11px] font-medium leading-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a151b] motion-reduce:transition-none xl:text-xs",
                                    selected
                                        ? "border-emerald-300/35 bg-emerald-300/10 text-emerald-200"
                                        : "border-white/10 bg-white/[0.025] text-slate-300 hover:border-white/25 hover:bg-white/[0.06] hover:text-white"
                                )}
                            >
                                <Icon className="hidden h-3.5 w-3.5 shrink-0 2xl:block" aria-hidden="true" />
                                <span>{t(feature.label)}</span>
                            </button>
                        )
                    })}
                </div>

                <div className="mt-4 flex items-center justify-between">
                    <p className="text-xs tabular-nums text-slate-400" aria-hidden="true">
                        <span className="font-medium text-slate-200">{String(currentSlide + 1).padStart(2, "0")}</span>
                        <span className="mx-2 text-slate-600">/</span>
                        {String(featureSlides.length).padStart(2, "0")}
                    </p>
                    <div className="flex items-center gap-2" role="group" aria-label={t("Slideshow controls")}>
                        <button
                            type="button"
                            aria-label={t(isAutoPlaying ? "Pause slideshow" : "Play slideshow")}
                            aria-pressed={isAutoPlaying}
                            onClick={() => setIsAutoPlaying(playing => !playing)}
                            className={cn(controlClassName, "mr-2")}
                        >
                            {isAutoPlaying ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
                        </button>
                        <button type="button" aria-label={t("Previous feature")} onClick={() => goToSlide(currentSlide - 1)} className={controlClassName}>
                            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button type="button" aria-label={t("Next feature")} onClick={() => goToSlide(currentSlide + 1)} className={controlClassName}>
                            <ArrowRight className="h-4 w-4" aria-hidden="true" />
                        </button>
                    </div>
                </div>
            </div>
        </section>
    )
}
