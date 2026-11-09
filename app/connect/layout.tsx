// Open Backup UI v1.0.2
import { AppStatusFooter } from '@/components/app-status-footer'

export default function ConnectLayout({
    children,
}: {
    children: React.ReactNode
}) {
    // Connect page has no sidebar - clean minimal layout
    return <>{children}<AppStatusFooter /></>
}
