import type { Metadata } from "next";
import { Geist, Geist_Mono, Manrope, Roboto } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { ActiveThemeProvider } from "@/components/active-theme";
import { normalizeTheme, themeOverrides, THEME_COOKIES } from "@/lib/themes";
import { cookies, headers } from "next/headers";
import { cn } from "@/lib/utils";
import { PostHogProvider } from "@/components/providers/posthog-provider";
import { I18nProvider } from "@/components/providers/i18n-provider";
import { LOCALE_COOKIE, normalizePreference, resolveLocale } from "@/lib/i18n/model";
import { readShare } from "@/lib/server/kiosk-shares";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Open Backup UI",
  description: "Unified monitoring dashboard for data protection environments",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // ... (keep existing logic)
  const cookieStore = await cookies();
  const headersList = await headers();
  const languagePreference = normalizePreference(cookieStore.get(LOCALE_COOKIE)?.value);
  const locale = resolveLocale(languagePreference, headersList.get("accept-language"));

  // Check if we're on the connect page (no sidebar needed)
  const pathname = headersList.get("x-pathname") || "";
  const isConnectPage = pathname === "/connect" || pathname.startsWith("/connect");

  const sharedId = /^\/share\/kiosk\/([A-Za-z0-9_-]{43})\/?$/.exec(pathname)?.[1];
  const shared = sharedId ? await readShare(sharedId).catch(() => null) : null;
  const publicPage = pathname.startsWith('/share/kiosk/');
  const consolePage = /^\/vbr\/activity\/[^/]+\/console\/?$/.test(pathname);
  const themeSettings = normalizeTheme(shared?.theme ?? Object.fromEntries(
    Object.entries(THEME_COOKIES).map(([key, cookie]) => [key, cookieStore.get(cookie)?.value])
  ));

  const bodyAttributes = Object.fromEntries(
    Object.entries(themeSettings)
      .filter(([key, value]) => value && key !== "accentColor" && key !== "chartColor")
      .map(([key, value]) => [`data-theme-${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`, value])
  );

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={cn(`${geistSans.variable} ${geistMono.variable} ${manrope.variable} ${roboto.variable} antialiased bg-background group/layout font-sans`)}
        data-connect-page={isConnectPage ? "true" : undefined}
        style={themeOverrides(themeSettings) as React.CSSProperties}
        {...bodyAttributes}
      >
        <I18nProvider initialLocale={locale} initialPreference={languagePreference}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
          forcedTheme={publicPage ? shared?.mode ?? 'dark' : undefined}
        >
          <ActiveThemeProvider initialTheme={themeSettings} persist={!publicPage}>
            {publicPage || consolePage ? children : <PostHogProvider>
              {children}
              <Toaster />
            </PostHogProvider>}
          </ActiveThemeProvider>
        </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
