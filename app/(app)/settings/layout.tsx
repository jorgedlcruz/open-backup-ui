// Open Backup UI v1.3.0
import { getRequestI18n } from '@/lib/i18n/server'

export async function generateMetadata() {
  const { t } = await getRequestI18n()
  return { title: `${t('Settings')} | Open Backup UI` }
}

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children
}
