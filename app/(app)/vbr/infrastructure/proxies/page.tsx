import { ProxyOperations } from '@/components/proxies/proxy-operations'

export const metadata = { title: 'Backup Proxies', description: 'Backup proxy availability, transport policy, and task limits.' }
export default function BackupProxiesPage() {
  return <ProxyOperations />
}
