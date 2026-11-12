// Open Backup UI v1.2.0
import { VirtualOperations } from '@/components/virtual-infrastructure/virtual-operations'
import { getRequestI18n } from '@/lib/i18n/server'

export async function generateMetadata() {
  const { t } = await getRequestI18n()
  return { title: `${t('Virtual Infrastructure')} | Open Backup UI` }
}

export default function VirtualInfrastructurePage() {
    return <VirtualOperations />
}
