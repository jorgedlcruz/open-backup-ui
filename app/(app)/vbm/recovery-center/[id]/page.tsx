// Open Backup UI v1.3.0
import { RecoverySessionWorkspace } from '@/components/vbm-recovery/session'
import { getRequestI18n } from '@/lib/i18n/server'
import { recoverySessionReference } from '@/lib/vbm-recovery/presentation'
import { notFound } from 'next/navigation'

type PageProps = {params: Promise<{id: string}>}

export async function generateMetadata({params}: PageProps) {
  const [{id}, {t}] = await Promise.all([params, getRequestI18n()])
  const reference = recoverySessionReference(id)
  if (!reference) notFound()
  return {title: `${t('Recovery session')} · ${reference} · ${t('Microsoft 365')} | Open Backup UI`}
}

export default async function Page({params}: PageProps) {
  const {id} = await params
  if (!recoverySessionReference(id)) notFound()
  return <RecoverySessionWorkspace key={id} id={id}/>
}
