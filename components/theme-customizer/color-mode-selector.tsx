"use client"
import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { AppearanceOptions } from "./appearance-options"
export function ColorModeSelector() {
    const { theme, setTheme } = useTheme()
    const [mounted, setMounted] = useState(false)
    useEffect(() => setMounted(true), [])
    if (!mounted) return <div className="h-9 rounded-md bg-muted" aria-label="Loading color mode" />
    return <AppearanceOptions label="Color mode" value={theme || "system"} onChange={setTheme} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }]} />
}
