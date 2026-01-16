"use client"

import { LandingPage } from "@/components/landing/landing-page"
import { DataSourcesProvider } from "@/lib/context/data-sources-context"

export default function ConnectPage() {
    return (
        <DataSourcesProvider>
            <LandingPage />
        </DataSourcesProvider>
    )
}
