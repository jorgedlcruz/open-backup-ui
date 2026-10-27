"use client"
import { useThemeConfig } from "@/components/active-theme"
import { AppearanceOptions } from "./appearance-options"
export function ContentLayoutSelector() {
    const { theme, setTheme } = useThemeConfig()
    return <AppearanceOptions label="Content width" value={theme.contentLayout} onChange={contentLayout => setTheme({ ...theme, contentLayout })} options={[{ value: "full", label: "Full" }, { value: "centered", label: "Centered" }]} />
}
