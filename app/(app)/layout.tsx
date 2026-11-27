// Open Backup UI v1.3.0
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { AppStatusFooter } from "@/components/app-status-footer";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { SectionNamesProvider } from "@/lib/context/section-names-context";
import { catalog } from "@/lib/server/data-sources";
import { workspaceConnections } from "@/lib/data-sources/model";
import { cookies } from "next/headers";
import { LABS_COOKIE } from '@/lib/labs/model';

export default async function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const cookieStore = await cookies();
    const configuredPlatforms = [...new Set(catalog(cookieStore).map(source => source.type))];
    const connections = workspaceConnections(cookieStore, process.env);

    return (
        <SectionNamesProvider>
            <SidebarProvider defaultOpen={cookieStore.get("sidebar_state")?.value !== "false"}>
                <AppSidebar
                    labsEnabled={cookieStore.get(LABS_COOKIE)?.value === 'true'}
                    configuredPlatforms={configuredPlatforms}
                />
                <SidebarInset>
                    <AppHeader labsEnabled={cookieStore.get(LABS_COOKIE)?.value === 'true'}
                        vbrConfigured={connections.vbr || configuredPlatforms.includes('vbr')}
                        vb365Configured={connections.vb365 || configuredPlatforms.includes('vb365')}
                        sourceScope={JSON.stringify([cookieStore.get('veeam_source_id')?.value, cookieStore.get('veeam_vb365_source_id')?.value])} />
                    <div className="app-content"><AppBreadcrumbs />{children}</div>
                    <AppStatusFooter />
                </SidebarInset>
            </SidebarProvider>
        </SectionNamesProvider>
    );
}
