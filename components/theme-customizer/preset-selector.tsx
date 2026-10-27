"use client";

import { THEMES } from "@/lib/themes";
import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import { useThemeConfig } from "@/components/active-theme";
import styles from "./preset-selector.module.css";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";


export function PresetSelector() {
    const { theme, setTheme } = useThemeConfig();

    const handlePreset = (value: string) => {
        setTheme({ ...theme, preset: value });
    };

    return (
        <div className="flex flex-col gap-3 pt-2">
            <div className={styles.gallery} role="group" aria-label="Glass themes">
                {THEMES.filter(preset => preset.value.startsWith("glass-")).map(preset => (
                    <button
                        key={preset.value}
                        type="button"
                        className={styles.preset}
                        aria-label={`Apply ${preset.name}`}
                        aria-pressed={theme.preset === preset.value}
                        onClick={() => handlePreset(preset.value)}
                        style={{ "--swatch-accent": preset.colors[0], "--swatch-middle": preset.colors[1], "--swatch-glow": preset.colors[2] } as CSSProperties}
                    >
                        <span className={styles.scene} aria-hidden="true">
                            <span className={styles.miniNav}><i /><i /><i /></span>
                            <span className={styles.miniMain}>
                                <span className={styles.miniTitle} />
                                <span className={styles.miniMetrics}><i /><i /><i /></span>
                                <span className={styles.miniChart}>
                                    <svg viewBox="0 0 100 28" fill="none"><path d="M0 24 C12 24 10 15 24 17 S40 24 49 13 S65 22 75 9 S90 12 100 3" /></svg>
                                </span>
                            </span>
                            {theme.preset === preset.value && <span className={styles.selectedMark}><Check size={11} strokeWidth={3} /></span>}
                        </span>
                        <span className={styles.name}>{preset.name.replace("Glass ", "")}</span>
                        <span className={styles.description}>{preset.value === "glass-ocean" ? "Blue & cyan" : preset.value === "glass-forest" ? "Emerald & teal" : "Violet & rose"}</span>
                    </button>
                ))}
            </div>
            <Select value={theme.preset} onValueChange={(value) => handlePreset(value)}>
                <SelectTrigger className="w-full" aria-label="Theme preset">
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
