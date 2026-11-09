import { notFound } from 'next/navigation'
import { ActivitySession } from '@/components/activity/activity-session'
import { validId } from '@/lib/investigation/model'
import { getRequestI18n } from '@/lib/i18n/server'

export async function generateMetadata() {
  const {t} = await getRequestI18n()
  return {title: t('Session Investigation') + ' · ' + t('Activity') + ' | Open Backup UI'}
}
export default async function Page({params, searchParams}: {
  params: Promise<{id: string}>; searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const id = (await params).id.toLowerCase(), search = await searchParams
  if (!validId(id)) notFound()
  const query = new URLSearchParams()
  for (const name of ['mount','kind','sourceKey']) if (typeof search[name] === 'string') query.set(name, search[name])
  return <ActivitySession key={id + query.toString()} id={id} query={query.toString()}/>
}
