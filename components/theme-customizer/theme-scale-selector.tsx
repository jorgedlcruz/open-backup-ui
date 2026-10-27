"use client"
import { useThemeConfig } from "@/components/active-theme"
import { AppearanceOptions } from "./appearance-options"
export function ThemeScaleSelector() {
    const { theme, setTheme } = useThemeConfig()
    return <AppearanceOptions label="Scale" value={theme.scale} onChange={scale => setTheme({ ...theme, scale })} options={[{ value: "none", label: "Default" }, { value: "sm", label: "Compact" }, { value: "lg", label: "Large" }]} />
}
