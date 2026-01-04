"use client";

import { DEFAULT_THEME, THEMES } from "@/lib/themes";
import { useThemeConfig } from "@/components/active-theme";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

export function PresetSelector() {
    const { theme, setTheme } = useThemeConfig();

    const handlePreset = (value: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setTheme({ ...theme, ...DEFAULT_THEME, preset: value as any });
    };

    return (
        <div className="flex flex-col gap-4">
            <Label>Theme preset:</Label>
            <Select value={theme.preset} onValueChange={(value) => handlePreset(value)}>
                <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a theme" />
                </SelectTrigger>
                <SelectContent align="end">
                    {THEMES.map((theme) => (
                        <SelectItem key={theme.name} value={theme.value}>
                            <div className="flex items-center gap-2">
                                <div className="flex shrink-0 gap-1">
                                    {theme.colors.map((color, key) => (
                                        <span
                                            key={key}
                                            className="size-2 rounded-full"
                                            style={{ backgroundColor: color }}></span>
                                    ))}
                                </div>
                                {theme.name}
                            </div>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}
