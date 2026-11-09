// Open Backup UI v1.0.2
import type { Metadata } from 'next'
import { VbmDashboard } from '@/components/vbm-dashboard/vbm-dashboard'
export const metadata: Metadata = { title: 'Microsoft 365 Operations | Open Backup UI' }
export const dynamic = 'force-dynamic'
export default function DashboardPage() { return <VbmDashboard/> }
