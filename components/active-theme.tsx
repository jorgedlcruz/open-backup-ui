"use client";

import { ReactNode, createContext, useContext, useEffect, useRef, useState } from "react";
import { normalizeTheme, themeOverrides, THEME_COOKIES, ThemeType } from "@/lib/themes";

function setThemeCookie(key: string, value: string | null) {
    if (typeof window === "undefined") return;

    if (!value) {
        document.cookie = `${key}=; path=/; max-age=0; SameSite=Lax; ${window.location.protocol === "https:" ? "Secure;" : ""}`;
    } else {
        document.cookie = `${key}=${value}; path=/; max-age=31536000; SameSite=Lax; ${window.location.protocol === "https:" ? "Secure;" : ""}`;
    }
}

type ThemeContextType = {
    theme: ThemeType;
    setTheme: (theme: ThemeType) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ActiveThemeProvider({
    children,
    initialTheme
}: {
    children: ReactNode;
    initialTheme?: ThemeType;
}) {
    const [theme, setTheme] = useState<ThemeType>(() =>
        normalizeTheme(initialTheme)
    );
    const previousOverrides = useRef(themeOverrides(initialTheme));

    useEffect(() => {
        const body = document.body;

        for (const key of Object.keys(THEME_COOKIES) as (keyof ThemeType)[]) {
            setThemeCookie(THEME_COOKIES[key], theme[key] || null);
            if (key !== "accentColor" && key !== "chartColor") {
                body.setAttribute(`data-theme-${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`, theme[key]);
            }
        }
        const overrides = themeOverrides(theme);
        for (const key of Object.keys(previousOverrides.current)) if (!(key in overrides)) body.style.removeProperty(key);
        for (const [key, value] of Object.entries(overrides)) body.style.setProperty(key, value);
        previousOverrides.current = overrides;
    }, [theme]);

    return <ThemeContext.Provider value={{ theme, setTheme: value => setTheme(normalizeTheme(value)) }}>{children}</ThemeContext.Provider>;
}

export function useThemeConfig() {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error("useThemeConfig must be used within an ActiveThemeProvider");
    }
    return context;
}
