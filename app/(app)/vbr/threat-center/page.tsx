// Open Backup UI v1.0.2
import { RansomwareOperations } from '@/components/ransomware/ransomware-operations'
import { getRequestI18n } from '@/lib/i18n/server'

export async function generateMetadata() {
  const { t } = await getRequestI18n()
  return { title: `${t('Ransomware Detection')} | Open Backup UI` }
}

export default function RansomwareDetectionPage() {
  return <RansomwareOperations />
}
