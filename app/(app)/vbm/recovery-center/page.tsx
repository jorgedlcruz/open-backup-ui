// Open Backup UI v1.3.0
import { Suspense } from 'react'
import { Microsoft365RecoveryCenter } from '@/components/vbm-recovery/center'
import { getRequestI18n } from '@/lib/i18n/server'

export async function generateMetadata() {
  const {t}=await getRequestI18n()
  return {title:`${t('Recovery Center')} · ${t('Microsoft 365')} | Open Backup UI`}
}
export default function Page() {
  return <Suspense><Microsoft365RecoveryCenter/></Suspense>
}
