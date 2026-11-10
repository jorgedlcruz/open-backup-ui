// Open Backup UI v1.2.0
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { AppStatusFooter } from "@/components/app-status-footer";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { SectionNamesProvider } from "@/lib/context/section-names-context";
import { configStore } from "@/lib/server/config-store";
import { cookies } from "next/headers";
import { LABS_COOKIE } from '@/lib/labs/model';

export default async function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const cookieStore = await cookies();
    const storedSources = configStore.getAll();

    // Check configuration: Global ConfigStore (Preferred) -> Legacy Cookies -> Env Vars
    const vbrConfigured = !!(
        storedSources.some(s => s.platform === 'vbr') ||
        cookieStore.get('veeam_source_id') ||
        process.env.VEEAM_API_URL
    );

    const vb365Configured = !!(
        storedSources.some(s => s.platform === 'vb365') ||
        cookieStore.get('veeam_vb365_token') ||
        process.env.VBM_API_URL
    );

    const vroConfigured = !!(
        storedSources.some(s => s.platform === 'vro') ||
        cookieStore.get('veeam_vro_token') ||
        process.env.VRO_API_URL
    );

    const veeamOneConfigured = !!(
        storedSources.some(s => s.platform === 'one') ||
        cookieStore.get('veeam_one_token') ||
        process.env.VEEAM_ONE_API_URL
    );

    return (
        <SectionNamesProvider>
            <SidebarProvider defaultOpen={cookieStore.get("sidebar_state")?.value !== "false"}>
                <AppSidebar
                    labsEnabled={cookieStore.get(LABS_COOKIE)?.value === 'true'}
                    vbrConfigured={vbrConfigured}
                    vb365Configured={vb365Configured}
                    vroConfigured={vroConfigured}
                    veeamOneConfigured={veeamOneConfigured}
                />
                <SidebarInset>
                    <AppHeader labsEnabled={cookieStore.get(LABS_COOKIE)?.value === 'true'} vbrConfigured={vbrConfigured} vb365Configured={vb365Configured}
                        sourceScope={JSON.stringify([cookieStore.get('veeam_source_id')?.value, cookieStore.get('veeam_vb365_source_id')?.value])} />
                    <div className="app-content"><AppBreadcrumbs />{children}</div>
                    <AppStatusFooter />
                </SidebarInset>
            </SidebarProvider>
        </SectionNamesProvider>
    );
}
