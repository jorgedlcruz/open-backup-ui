"use client";

import { Label } from "@/components/ui/label";
import { useThemeConfig } from "@/components/active-theme";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function ContentLayoutSelector() {
    const { theme, setTheme } = useThemeConfig();

    return (
        <div className="hidden flex-col gap-4 lg:flex">
            <Label>Content layout</Label>
            <ToggleGroup
                value={theme.contentLayout}
                type="single"
                onValueChange={(value) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    setTheme({ ...theme, contentLayout: value as any })
                }}
                className="*:border-input w-full gap-4 *:rounded-md *:border">
                <ToggleGroupItem variant="outline" value="full">
                    Full
                </ToggleGroupItem>
                <ToggleGroupItem
                    variant="outline"
                    value="centered"
                    className="data-[variant=outline]:border-l-1">
                    Centered
                </ToggleGroupItem>
            </ToggleGroup>
        </div>
    );
}
