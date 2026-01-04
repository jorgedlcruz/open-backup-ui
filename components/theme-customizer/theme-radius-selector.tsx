"use client";

import { Label } from "@/components/ui/label";
import { useThemeConfig } from "@/components/active-theme";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BanIcon } from "lucide-react";

export function ThemeRadiusSelector() {
    const { theme, setTheme } = useThemeConfig();

    return (
        <div className="flex flex-col gap-4">
            <Label htmlFor="roundedCorner">Radius:</Label>
            <ToggleGroup
                value={theme.radius}
                type="single"
                onValueChange={(value) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    setTheme({ ...theme, radius: value as any })
                }}
                className="*:border-input w-full gap-3 *:rounded-md *:border">
                <ToggleGroupItem variant="outline" value="none">
                    <BanIcon />
                </ToggleGroupItem>
                <ToggleGroupItem
                    variant="outline"
                    value="sm"
                    className="text-xs data-[variant=outline]:border-l-1">
                    SM
                </ToggleGroupItem>
                <ToggleGroupItem
                    variant="outline"
                    value="md"
                    className="text-xs data-[variant=outline]:border-l-1">
                    MD
                </ToggleGroupItem>
                <ToggleGroupItem
                    variant="outline"
                    value="lg"
                    className="text-xs data-[variant=outline]:border-l-1">
                    LG
                </ToggleGroupItem>
                <ToggleGroupItem
                    variant="outline"
                    value="xl"
                    className="text-xs data-[variant=outline]:border-l-1">
                    XL
                </ToggleGroupItem>
            </ToggleGroup>
        </div>
    );
}
