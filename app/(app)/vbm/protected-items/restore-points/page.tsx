// Open Backup UI v1.2.0
import { Suspense } from 'react'
import { RestorePoints } from '@/components/vbm-protected/restore-points'
import { Loading } from '@/components/investigation/shared'
import { getRequestI18n } from '@/lib/i18n/server'
export async function generateMetadata() {const {t}=await getRequestI18n();return {title:`${t('Restore-point history')} | Microsoft 365`}}
export default function Page() {return <Suspense fallback={<Loading/>}><RestorePoints/></Suspense>}
