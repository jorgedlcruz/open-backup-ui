import { LicensingClient } from "@/components/administration/licensing-client"
import { cookies } from "next/headers"
import { configStore } from "@/lib/server/config-store"
import { getChunkedCookie } from "@/lib/utils/cookie-manager"

export default async function LicensingPage() {
    const cookieStore = await cookies()
    const storedSources = configStore.getAll()

    // Robust check for VBR configuration
    const hasVBR = !!(
        storedSources.some(s => s.platform === 'vbr') ||
        cookieStore.get('veeam_source_id') ||
        process.env.VEEAM_API_URL
    )

    // Robust check for VB365 configuration
    const hasVB365 = !!(
        storedSources.some(s => s.platform === 'vb365') ||
        getChunkedCookie(cookieStore, 'veeam_vb365_token') ||
        process.env.VBM_API_URL
    )

    return <LicensingClient hasVBR={hasVBR} hasVB365={hasVB365} />
}
