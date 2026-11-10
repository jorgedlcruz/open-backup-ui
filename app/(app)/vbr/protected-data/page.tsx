// Open Backup UI v1.2.0
import { ProtectedDataOperations } from '@/components/protected-data/protected-data-operations'
import { getRequestI18n } from '@/lib/i18n/server'

export async function generateMetadata() {
  const { t } = await getRequestI18n()
  return { title: `${t('Protected Data')} | Open Backup UI` }
}
export default function ProtectedDataPage(){return <ProtectedDataOperations/>}
