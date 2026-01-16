"use client"

import {
    PresetSelector,
    ThemeScaleSelector,
    ColorModeSelector,
    ContentLayoutSelector,
    ThemeRadiusSelector,
    ResetThemeButton,
    SidebarModeSelector,
    SectionNamesEditor
} from "@/components/theme-customizer"
import { Separator } from "@/components/ui/separator"

export default function BrandingPage() {
    return (
        <div className="flex-1 overflow-auto">
            <div className="container mx-auto py-8 px-4 space-y-4">
                <div className="space-y-2">
                    <h2 className="text-3xl font-bold tracking-tight">Branding & Appearance</h2>
                    <p className="text-muted-foreground">
                        Customize the look and feel of the application.
                    </p>
                </div>
                <Separator className="my-6" />
                <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
                    <div className="space-y-6">
                        <div className="space-y-2">
                            <LabelDescription label="Theme Preset" description="Select a primary color theme for the application." />
                            <PresetSelector />
                        </div>
                        <div className="space-y-2">
                            <LabelDescription label="Color Mode" description="Choose between light and dark mode." />
                            <ColorModeSelector />
                        </div>
                    </div>
                    <div className="space-y-6">
                        <div className="space-y-2">
                            <LabelDescription label="Radius" description="Adjust the roundness of UI elements." />
                            <ThemeRadiusSelector />
                        </div>
                        <div className="space-y-2">
                            <LabelDescription label="Scale" description="Adjust the size of UI elements." />
                            <ThemeScaleSelector />
                        </div>
                    </div>
                    <div className="space-y-6">
                        <div className="space-y-2">
                            <LabelDescription label="Sidebar" description="Control the sidebar presentation." />
                            <SidebarModeSelector />
                        </div>
                        <div className="space-y-2">
                            <LabelDescription label="Layout" description="Choose the content layout width." />
                            <ContentLayoutSelector />
                        </div>
                    </div>
                </div>

                <Separator className="my-6" />

                <div className="space-y-4">
                    <LabelDescription
                        label="Section Names"
                        description="Customize the sidebar section labels to match your organization's terminology."
                    />
                    <SectionNamesEditor />
                </div>

                <Separator className="my-6" />

                <div className="flex justify-start">
                    <div className="w-full md:w-auto">
                        <ResetThemeButton />
                    </div>
                </div>
            </div>
        </div>
    )
}

function LabelDescription({ label, description }: { label: string, description: string }) {
    return (
        <div className="mb-2">
            <h4 className="text-sm font-semibold leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">{label}</h4>
            <p className="text-[0.8rem] text-muted-foreground">
                {description}
            </p>
        </div>
    )
}
