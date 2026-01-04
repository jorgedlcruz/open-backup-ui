"use client";

import { Label } from "@/components/ui/label";
import { useThemeConfig } from "@/components/active-theme";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BanIcon } from "lucide-react";

export function ThemeScaleSelector() {
    const { theme, setTheme } = useThemeConfig();

    return (
        <div className="flex flex-col gap-4">
            <Label htmlFor="roundedCorner">Scale:</Label>
            <div>
                <ToggleGroup
                    value={theme.scale}
                    type="single"
                    onValueChange={(value) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        setTheme({ ...theme, scale: value as any })
                    }}
                    className="*:border-input w-full gap-3 *:rounded-md *:border">
                    <ToggleGroupItem variant="outline" value="none">
                        <BanIcon />
                    </ToggleGroupItem>
                    <ToggleGroupItem
                        variant="outline"
                        value="sm"
                        className="text-xs data-[variant=outline]:border-l-1">
                        XS
                    </ToggleGroupItem>
                    <ToggleGroupItem
                        variant="outline"
                        value="lg"
                        className="text-xs data-[variant=outline]:border-l-1">
                        LG
                    </ToggleGroupItem>
                </ToggleGroup>
            </div>
        </div>
    );
}
