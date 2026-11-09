// Open Backup UI v1.0.2
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { JobInvestigation } from '@/components/vbm-jobs/job-investigation'
import { getRequestI18n } from '@/lib/i18n/server'
export const dynamic='force-dynamic'
export async function generateMetadata():Promise<Metadata> {const {t}=await getRequestI18n();return {title:`${t('Job Investigation')} | Microsoft 365`}}
export default async function Page() {const {t}=await getRequestI18n();return <Suspense fallback={<div className="p-8">{t('Loading job investigation…')}</div>}><JobInvestigation/></Suspense>}
