"use client";

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTheme } from "next-themes";

export function ColorModeSelector() {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        return (
            <div className="flex flex-col gap-4">
                <Label htmlFor="roundedCorner">Color mode:</Label>
                <div className="h-10 w-full rounded-md border border-input bg-muted/50" />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <Label htmlFor="roundedCorner">Color mode:</Label>
            <ToggleGroup
                value={theme}
                type="single"
                onValueChange={(value) => value && setTheme(value)}
                className="*:border-input w-full gap-4 *:rounded-md *:border">
                <ToggleGroupItem variant="outline" value="light">
                    Light
                </ToggleGroupItem>
                <ToggleGroupItem
                    variant="outline"
                    value="dark"
                    className="data-[variant=outline]:border-l-1">
                    Dark
                </ToggleGroupItem>
            </ToggleGroup>
        </div>
    );
}
