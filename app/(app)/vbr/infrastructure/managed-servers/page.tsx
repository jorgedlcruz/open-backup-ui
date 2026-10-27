import { ServerOperations } from '@/components/managed-servers/server-operations'

export const metadata = { title: 'Managed Servers', description: 'Managed-server availability, updates, and assigned roles.' }
export default function ManagedServersPage() {
  return <ServerOperations />
}
