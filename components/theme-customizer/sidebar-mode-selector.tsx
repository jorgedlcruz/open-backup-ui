"use client"
import { useSidebar } from "@/components/ui/sidebar"
import { AppearanceOptions } from "./appearance-options"
export function SidebarModeSelector() {
    const { open, setOpen } = useSidebar()
    return <AppearanceOptions label="Desktop sidebar" value={open ? "full" : "icon"} onChange={value => setOpen(value === "full")} options={[{ value: "full", label: "Default" }, { value: "icon", label: "Icon" }]} />
}
