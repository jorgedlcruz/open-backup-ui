"use client"
import { useThemeConfig } from "@/components/active-theme"
import { AppearanceOptions } from "./appearance-options"
export function ThemeRadiusSelector() {
    const { theme, setTheme } = useThemeConfig()
    return <AppearanceOptions label="Corners" value={theme.radius} onChange={radius => setTheme({ ...theme, radius })} options={[{ value: "default", label: "Preset" }, { value: "none", label: "Square" }, { value: "sm", label: "SM" }, { value: "md", label: "MD" }, { value: "lg", label: "LG" }, { value: "xl", label: "XL" }]} />
}
