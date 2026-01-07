"use client";


import { useThemeConfig } from "@/components/active-theme";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BanIcon } from "lucide-react";

export function ThemeRadiusSelector() {
    const { theme, setTheme } = useThemeConfig();

    return (
        <div className="flex pt-2">
            <ToggleGroup
                value={theme.radius}
                type="single"
                onValueChange={(value) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    setTheme({ ...theme, radius: value as any })
                }}
                className="gap-2 justify-start">
                <ToggleGroupItem variant="outline" value="none" className="h-9 w-9 p-0">
                    <BanIcon className="h-4 w-4" />
                </ToggleGroupItem>
                <ToggleGroupItem
                    variant="outline"
                    value="sm"
                    className="h-9 w-9 p-0 text-xs">
                    SM
                </ToggleGroupItem>
                <ToggleGroupItem
                    variant="outline"
                    value="md"
                    className="h-9 w-9 p-0 text-xs">
                    MD
                </ToggleGroupItem>
                <ToggleGroupItem
                    variant="outline"
                    value="lg"
                    className="h-9 w-9 p-0 text-xs">
                    LG
                </ToggleGroupItem>
                <ToggleGroupItem
                    variant="outline"
                    value="xl"
                    className="h-9 w-9 p-0 text-xs">
                    XL
                </ToggleGroupItem>
            </ToggleGroup>
        </div>
    );
}
