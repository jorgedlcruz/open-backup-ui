"use client";


import { useThemeConfig } from "@/components/active-theme";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function ContentLayoutSelector() {
    const { theme, setTheme } = useThemeConfig();

    return (
        <div className="hidden flex-col gap-2 pt-2 lg:flex">
            <ToggleGroup
                value={theme.contentLayout}
                type="single"
                onValueChange={(value) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    setTheme({ ...theme, contentLayout: value as any })
                }}
                className="gap-2 justify-start">
                <ToggleGroupItem variant="outline" value="full" className="w-[80px]">
                    Full
                </ToggleGroupItem>
                <ToggleGroupItem
                    variant="outline"
                    value="centered"
                    className="w-[80px] data-[variant=outline]:border-l-1">
                    Centered
                </ToggleGroupItem>
            </ToggleGroup>
        </div>
    );
}
