"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useTheme } from "next-themes"
import { Check, Monitor, Palette, SlidersHorizontal, Type } from "lucide-react"
import { useThemeConfig } from "@/components/active-theme"
import { Panel } from "@/components/investigation/shared"
import { THEMES, THEME_FONTS, type ThemeType } from "@/lib/themes"
import { cn } from "@/lib/utils"
import { PresetSelector, ColorModeSelector, ThemeScaleSelector, ThemeRadiusSelector, ContentLayoutSelector, SidebarModeSelector, SectionNamesEditor, ResetThemeButton } from "./index"
import { BrandColors } from "./brand-colors"
import { ThemePreview } from "./theme-preview"
import ops from "@/components/operations/operations.module.css"
import styles from "./branding.module.css"

function Field({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
    return <div className={styles.field}><h3>{title}</h3>{hint && <p>{hint}</p>}{children}</div>
}

export function BrandingConsole() {
    const { theme, setTheme } = useThemeConfig()
    const { theme: mode, resolvedTheme } = useTheme()
    const [mounted, setMounted] = useState(false)
    useEffect(() => setMounted(true), [])
    const preset = THEMES.find(preset => preset.value === theme.preset)!
    const font = THEME_FONTS.find(font => font.value === theme.font)!
    return <div className={cn(ops.console, styles.page)}>
        <header className={ops.header}>
            <div><h1>Branding & Appearance</h1><p>Make the console your own. Preview every change as you work.</p></div>
            <div className={styles.saveHint}><Check size={14} /><div><strong>Applies instantly</strong><span>Preferences saved in this browser</span></div></div>
        </header>

        <div className={styles.summary} aria-label="Current appearance">
            <div><Palette size={15} /><span>Theme <strong>{preset.name}</strong></span></div>
            <div><Monitor size={15} /><span>Mode <strong>{mounted ? mode === "system" ? `System · ${resolvedTheme}` : mode : "Loading…"}</strong></span></div>
            <div><Type size={15} /><span>Font <strong>{font.name}</strong></span></div>
            <div><SlidersHorizontal size={15} /><span>Colors <strong>{[theme.accentColor, theme.chartColor].filter(Boolean).length ? "Custom accents" : "Preset palette"}</strong></span></div>
        </div>

        <div className={styles.workspace}>
            <div className={styles.controls}>
                <Panel title="Theme & colors" subtitle="A shared visual language for every connected platform.">
                    <div className={styles.panelBody}>
                        <Field title="Theme preset" hint="Glass adds layered color and translucent surfaces to the compact Operations style."><PresetSelector /><p className={styles.help}>Every preset supports light and dark modes. Your custom accents and typography stay selected.</p></Field>
                        <Field title="Color mode"><ColorModeSelector /></Field>
                        <Field title="Your palette" hint="Accent colors apply across the console. Leave blank to follow the preset; press Enter or leave a hex field to apply."><BrandColors /><p className={styles.help}>Brand accent styles actions and navigation. Chart accent styles the secondary chart series. Health and result colors stay consistent.</p></Field>
                    </div>
                </Panel>
                <Panel title="Typography & density" subtitle="Tune readability for the way you work.">
                    <div className={styles.panelBody}>
                        <div className={styles.fontLabel}><label htmlFor="brand-font">Interface font</label><select id="brand-font" value={theme.font} onChange={event => setTheme({ ...theme, font: event.target.value as ThemeType["font"] })}>{THEME_FONTS.map(font => <option key={font.value} value={font.value}>{font.name}</option>)}</select></div>
                        <Field title="Scale" hint="Compact, default, or large interface sizing."><ThemeScaleSelector /></Field>
                        <Field title="Corners" hint="Follow the preset or choose a custom radius."><ThemeRadiusSelector /></Field>
                    </div>
                </Panel>
                <Panel title="Workspace layout" subtitle="Keep navigation and content comfortable on your screen.">
                    <div className={cn(styles.panelBody, styles.layoutFields)}>
                        <Field title="Desktop sidebar" hint="Show labels or keep only icons."><SidebarModeSelector /></Field>
                        <Field title="Content width" hint="Centered limits wide screens to 1,440 px."><ContentLayoutSelector /></Field>
                    </div>
                </Panel>
            </div>
            <aside className={styles.previewColumn} aria-label="Appearance preview"><ThemePreview /></aside>
        </div>

        <Panel title="Section names" subtitle="Use your organization's terminology in the sidebar. Each label can be reset individually." className={styles.sectionNames}>
            <div className={styles.panelBody}><SectionNamesEditor /></div>
        </Panel>
        <div className={styles.resetRow}><div><h2>Restore the default appearance</h2><p>Resets the preset, accents, font, scale, corners, and content width. Color mode, sidebar mode, and section names keep their own settings.</p></div><ResetThemeButton /></div>
    </div>
}
