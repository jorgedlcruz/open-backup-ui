// Open Backup UI v1.3.0
import { EntraInventoryPage } from '@/components/entra-inventory/entra-inventory-page'
import { getRequestI18n } from '@/lib/i18n/server'

export async function generateMetadata() {
  const { t } = await getRequestI18n()
  return { title: `${t('Microsoft Entra ID')} | Open Backup UI` }
}

export default function Page() {
  return <EntraInventoryPage />
}
