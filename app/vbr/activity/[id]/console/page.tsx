import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { VmwareConsoleViewer } from '@/components/activity/vmware-console-viewer'
import { validId } from '@/lib/investigation/model'
import { getRequestI18n } from '@/lib/i18n/server'

export async function generateMetadata(): Promise<Metadata> {
  const {t} = await getRequestI18n()
  return {title: t('VM web console') + ' | Open Backup UI', robots: {index: false, follow: false}, referrer: 'no-referrer'}
}

export default async function Page({params, searchParams}: {
  params: Promise<{id: string}>; searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const {id} = await params
  const {sourceKey, mountId} = await searchParams
  if (!validId(id) || typeof sourceKey !== 'string' || !/^[a-f0-9]{64}$/.test(sourceKey) ||
    typeof mountId !== 'string' || !validId(mountId)) notFound()
  return <VmwareConsoleViewer key={sourceKey + id + mountId} sessionId={id.toLowerCase()} mountId={mountId.toLowerCase()} sourceKey={sourceKey}/>
}
