import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getChunkedCookie } from '@/lib/utils/cookie-manager'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
    const cookieStore = await cookies()

    // Check for authenticated platforms and redirect to the first available
    const vbrToken = cookieStore.get('veeam_source_id')?.value || getChunkedCookie(cookieStore, 'veeam_vbr_token')
    const vb365Token = getChunkedCookie(cookieStore, 'veeam_vb365_token')
    const vroToken = getChunkedCookie(cookieStore, 'veeam_vro_token')
    const voneToken = getChunkedCookie(cookieStore, 'veeam_one_token')

    // Also check legacy .env configuration
    const hasVBR = !!vbrToken || !!process.env.VEEAM_API_URL
    const hasVB365 = vb365Token || !!process.env.VBM_API_URL
    const hasVRO = vroToken || !!process.env.VRO_API_URL
    const hasVONE = voneToken || !!process.env.VEEAM_ONE_API_URL

    // Redirect to first available platform dashboard
    if (hasVBR) {
        redirect('/vbr/dashboard')
    } else if (hasVB365) {
        redirect('/vbm/dashboard')
    } else if (hasVONE) {
        redirect('/analytics/reports')
    } else if (hasVRO) {
        redirect('/vro')
    } else {
        // No platforms configured, go to connect page
        redirect('/connect')
    }
}
