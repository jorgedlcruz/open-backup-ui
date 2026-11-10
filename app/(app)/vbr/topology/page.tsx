// Open Backup UI v1.2.0
import { ProtectionTopology } from '@/components/topology/protection-topology'
import { getRequestI18n } from '@/lib/i18n/server'

export async function generateMetadata() {
  const { t } = await getRequestI18n()
  return { title: `${t('Protection Topology')} | Open Backup UI` }
}

export default function TopologyPage() {
  return <ProtectionTopology />
}
