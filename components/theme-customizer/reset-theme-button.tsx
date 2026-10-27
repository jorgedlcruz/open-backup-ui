"use client";

import { useThemeConfig } from "@/components/active-theme";
import { Button } from "@/components/ui/button";
import { DEFAULT_THEME } from "@/lib/themes";
import { RotateCcw } from "lucide-react";

export function ResetThemeButton() {
    const { setTheme } = useThemeConfig();

    const resetThemeHandle = () => {
        setTheme(DEFAULT_THEME);
    };

    return (
        <Button variant="outline" onClick={resetThemeHandle}>
            <RotateCcw size={14} /> Reset to Default
        </Button>
    );
}
