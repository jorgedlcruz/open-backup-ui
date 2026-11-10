// Open Backup UI v1.0.2
import { getRequestI18n } from '@/lib/i18n/server'
export { default } from '../../activity/[id]/page'

export async function generateMetadata() {
  const {t} = await getRequestI18n()
  return {title: t('Recovery session') + ' · ' + t('Recovery Center') + ' | Open Backup UI'}
}
