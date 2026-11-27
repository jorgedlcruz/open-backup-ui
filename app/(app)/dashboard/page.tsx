// Open Backup UI v1.3.0
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { workspaceConnections } from '@/lib/data-sources/model'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
    const connections = workspaceConnections(await cookies(), process.env)

    // Redirect to first available platform dashboard
    if (connections.vbr) {
        redirect('/vbr/lens')
    } else if (connections.vb365) {
        redirect('/vbm/dashboard')
    } else if (connections.one) {
        redirect('/analytics/reports')
    } else if (connections.vro) {
        redirect('/vro')
    } else {
        // No platforms configured, go to connect page
        redirect('/connect')
    }
}
