"use client"

import { useEffect, useRef, useState } from "react"
import { RotateCcw } from "lucide-react"
import { useThemeConfig } from "@/components/active-theme"
import { normalizeHex } from "@/lib/themes"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import styles from "./branding.module.css"

function ColorField({ label, value, token, onChange }: { label: string; value: string; token: string; onChange: (value: string) => void }) {
    const { theme } = useThemeConfig()
    const [draft, setDraft] = useState(value)
    const [pickerColor, setPickerColor] = useState("#37bd89")
    const swatch = useRef<HTMLLabelElement>(null)
    // Synchronize external resets without interrupting partially typed colors.
    useEffect(() => setDraft(value), [value, theme])
    const syncPickerColor = () => {
        if (!swatch.current) return
        const canvas = document.createElement("canvas")
        canvas.width = canvas.height = 1
        const context = canvas.getContext("2d")
        if (!context) return
        context.fillStyle = getComputedStyle(swatch.current).backgroundColor
        context.fillRect(0, 0, 1, 1)
        const [r, g, b] = context.getImageData(0, 0, 1, 1).data
        setPickerColor("#" + [r, g, b].map(channel => channel.toString(16).padStart(2, "0")).join(""))
    }
    const invalid = !!draft && !normalizeHex(draft)
    const id = label.toLowerCase().replaceAll(" ", "-")
    return <div className={styles.colorField}>
        <label htmlFor={id}>{label}</label>
        <div className={styles.colorControls}>
            <label ref={swatch} className={styles.swatchPicker} style={{ background: value || `var(${token})` }} title={`Choose ${label.toLowerCase()}`}>
                <input type="color" aria-label={`${label} picker`} value={value || pickerColor} onFocus={syncPickerColor} onPointerDown={syncPickerColor} onChange={event => { setDraft(event.target.value); onChange(event.target.value) }} />
            </label>
            <Input id={id} value={draft} placeholder="Preset color" maxLength={7} spellCheck={false} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined} onChange={event => setDraft(event.target.value)} onBlur={() => {
                if (!draft || normalizeHex(draft)) { const next = normalizeHex(draft); setDraft(next); onChange(next) }
            }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur() }} />
            <Button variant="ghost" size="icon" aria-label={`Reset ${label.toLowerCase()}`} title="Use preset color" disabled={!value && !draft} onClick={() => { setDraft(""); onChange("") }}><RotateCcw size={14} /></Button>
        </div>
        {invalid && <p className={styles.error} id={`${id}-error`}>Use a hex color, such as #37bd89.</p>}
    </div>
}

export function BrandColors() {
    const { theme, setTheme } = useThemeConfig()
    return <div className={styles.colorGrid}>
        <ColorField label="Brand accent" value={theme.accentColor} token="--primary" onChange={accentColor => setTheme({ ...theme, accentColor })} />
        <ColorField label="Chart accent" value={theme.chartColor} token="--chart-2" onChange={chartColor => setTheme({ ...theme, chartColor })} />
    </div>
}
