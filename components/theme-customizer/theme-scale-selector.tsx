"use client";


import { useThemeConfig } from "@/components/active-theme";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BanIcon } from "lucide-react";

export function ThemeScaleSelector() {
    const { theme, setTheme } = useThemeConfig();

    return (
        <div className="flex pt-2">
            <div>
                <ToggleGroup
                    value={theme.scale}
                    type="single"
                    onValueChange={(value) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        setTheme({ ...theme, scale: value as any })
                    }}
                    className="gap-2 justify-start">
                    <ToggleGroupItem variant="outline" value="none" className="h-9 w-9 p-0">
                        <BanIcon className="h-4 w-4" />
                    </ToggleGroupItem>
                    <ToggleGroupItem
                        variant="outline"
                        value="sm"
                        className="h-9 w-9 p-0 text-xs">
                        XS
                    </ToggleGroupItem>
                    <ToggleGroupItem
                        variant="outline"
                        value="lg"
                        className="h-9 w-9 p-0 text-xs">
                        LG
                    </ToggleGroupItem>
                </ToggleGroup>
            </div>
        </div>
    );
}
