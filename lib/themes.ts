export const DEFAULT_THEME = {
    preset: "default",
    radius: "default",
    scale: "none",
    contentLayout: "full",
    font: "preset",
    accentColor: "",
    chartColor: ""
} as const;

export type ThemeType = {
    preset: string;
    radius: "default" | "none" | "sm" | "md" | "lg" | "xl";
    scale: "none" | "sm" | "lg";
    contentLayout: "full" | "centered";
    font: "preset" | "system" | "geist" | "manrope" | "roboto";
    accentColor: string;
    chartColor: string;
};

export const THEMES = [
    {
        name: "Operations",
        value: "operations",
        colors: ["#37bd89", "#18191c", "#e9bd68"]
    },
    {
        name: "Glass Ocean",
        value: "glass-ocean",
        colors: ["#38d6ed", "#1559a5", "#7160c9"]
    },
    {
        name: "Glass Forest",
        value: "glass-forest",
        colors: ["#6fe0b5", "#17635c", "#778c47"]
    },
    {
        name: "Glass Aurora",
        value: "glass-aurora",
        colors: ["#c7b0ff", "#6450b3", "#c876a1"]
    },
    {
        name: "Default",
        value: "default",
        colors: ["oklch(0.33 0 0)"]
    },
    {
        name: "Beeam Sunrise",
        value: "beeam-sunrise",
        colors: ["oklch(0.78 0.22 145)"] // Viridis #00D15F
    },
    {
        name: "Underground",
        value: "underground",
        colors: ["oklch(0.5315 0.0694 156.19)"]
    },
    {
        name: "Rose Garden",
        value: "rose-garden",
        colors: ["oklch(0.5827 0.2418 12.23)"]
    },
    {
        name: "Lake View",
        value: "lake-view",
        colors: ["oklch(0.765 0.177 163.22)"]
    },
    {
        name: "Sunset Glow",
        value: "sunset-glow",
        colors: ["oklch(0.5827 0.2187 36.98)"]
    },
    {
        name: "Forest Whisper",
        value: "forest-whisper",
        colors: ["oklch(0.5276 0.1072 182.22)"]
    },
    {
        name: "Ocean Breeze",
        value: "ocean-breeze",
        colors: ["oklch(0.59 0.20 277.12)"]
    },
    {
        name: "Lavender Dream",
        value: "lavender-dream",
        colors: ["oklch(0.71 0.16 293.54)"]
    }
];

export const THEME_FONTS = [
    { value: "preset", name: "Preset typography", family: "" },
    { value: "system", name: "System sans", family: "ui-sans-serif, system-ui, sans-serif" },
    { value: "geist", name: "Geist", family: "var(--font-geist-sans), sans-serif" },
    { value: "manrope", name: "Manrope", family: "var(--font-manrope), sans-serif" },
    { value: "roboto", name: "Roboto", family: "var(--font-roboto), sans-serif" },
] as const;

export const THEME_COOKIES: Record<keyof ThemeType, string> = {
    preset: "theme_preset", radius: "theme_radius", scale: "theme_scale",
    contentLayout: "theme_content_layout", font: "theme_font",
    accentColor: "theme_accent_color", chartColor: "theme_chart_color",
};

export function normalizeHex(value: unknown): string {
    if (typeof value !== "string") return "";
    const hex = value.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
    if (/^#[0-9a-f]{3}$/.test(hex)) return "#" + [...hex.slice(1)].map(char => char + char).join("");
    return "";
}

/** Old cookies remain valid; malformed preferences never become CSS. */
export function normalizeTheme(input: unknown): ThemeType {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const choice = <T extends string>(key: string, allowed: readonly T[], fallback: T): T =>
        allowed.includes(value[key] as T) ? value[key] as T : fallback;
    return {
        preset: choice("preset", THEMES.map(theme => theme.value), DEFAULT_THEME.preset),
        radius: choice("radius", ["default", "none", "sm", "md", "lg", "xl"], DEFAULT_THEME.radius),
        scale: choice("scale", ["none", "sm", "lg"], DEFAULT_THEME.scale),
        contentLayout: choice("contentLayout", ["full", "centered"], DEFAULT_THEME.contentLayout),
        font: choice("font", THEME_FONTS.map(font => font.value), DEFAULT_THEME.font),
        accentColor: normalizeHex(value.accentColor), chartColor: normalizeHex(value.chartColor),
    };
}

/** Pick the higher-contrast foreground for solid custom-color controls. */
export function colorForeground(hex: string): "#000000" | "#ffffff" {
    const color = normalizeHex(hex);
    if (!color) return "#ffffff";
    const [r, g, b] = [1, 3, 5].map(offset => {
        const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "#000000" : "#ffffff";
}

/** Shared by SSR and the live provider, avoiding a flash of default branding. */
export function themeOverrides(input: unknown): Record<string, string> {
    const theme = normalizeTheme(input);
    const styles: Record<string, string> = {};
    const family = THEME_FONTS.find(font => font.value === theme.font)?.family;
    if (family) for (const key of ["--text-family", "--display-family", "--font-sans"]) styles[key] = family;
    if (theme.accentColor) {
        const accent = theme.accentColor;
        const foreground = colorForeground(accent);
        for (const key of ["--primary", "--ring", "--sidebar-primary", "--sidebar-ring", "--ops-accent", "--ops-action"]) styles[key] = accent;
        for (const key of ["--primary-foreground", "--sidebar-primary-foreground", "--ops-action-foreground"]) styles[key] = foreground;
        styles["--ops-action-hover"] = accent;
        styles["--accent"] = `color-mix(in srgb, ${accent} 15%, var(--card))`;
        styles["--accent-foreground"] = "var(--foreground)";
        styles["--sidebar-accent"] = "var(--accent)";
        styles["--sidebar-accent-foreground"] = "var(--foreground)";
    }
    // Generic chart palette only. Result/health colors remain independent.
    if (theme.chartColor) styles["--chart-2"] = theme.chartColor;
    return styles;
}
