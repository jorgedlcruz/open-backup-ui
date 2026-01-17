import type { Metadata } from "next";
import { Geist, Geist_Mono, Manrope, Roboto } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { ActiveThemeProvider } from "@/components/active-theme";
import { DEFAULT_THEME } from "@/lib/themes";
import { cookies, headers } from "next/headers";
import { cn } from "@/lib/utils";

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
  title: "Veeam Single-UI",
  description: "Veeam Backup & Replication Management",
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png" },
    ],
    apple: "/favicon.png",
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

  // Check if we're on the connect page (no sidebar needed)
  const pathname = headersList.get("x-pathname") || "";
  const isConnectPage = pathname === "/connect" || pathname.startsWith("/connect");

  const themeSettings = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    preset: (cookieStore.get("theme_preset")?.value ?? DEFAULT_THEME.preset) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    scale: (cookieStore.get("theme_scale")?.value ?? DEFAULT_THEME.scale) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    radius: (cookieStore.get("theme_radius")?.value ?? DEFAULT_THEME.radius) as any,
    contentLayout: (cookieStore.get("theme_content_layout")?.value ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      DEFAULT_THEME.contentLayout) as any
  };

  const bodyAttributes = Object.fromEntries(
    Object.entries(themeSettings)
      .filter(([, value]) => value)
      .map(([key, value]) => [`data-theme-${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`, value])
  );

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={cn(`${geistSans.variable} ${geistMono.variable} ${manrope.variable} ${roboto.variable} antialiased bg-background group/layout font-sans`)}
        data-connect-page={isConnectPage ? "true" : undefined}
        {...bodyAttributes}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <ActiveThemeProvider initialTheme={themeSettings}>
            {children}
            <Toaster />
          </ActiveThemeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
