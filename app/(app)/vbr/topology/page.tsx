// Open Backup UI v1.0.2
import { ProtectionTopology } from '@/components/topology/protection-topology'
import { getRequestI18n } from '@/lib/i18n/server'

export async function generateMetadata() {
  const { t } = await getRequestI18n()
  return { title: `${t('Protection Topology')} | Open Backup UI` }
}

export default function TopologyPage() {
  return <ProtectionTopology />
}
