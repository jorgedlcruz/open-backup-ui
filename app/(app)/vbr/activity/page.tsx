// Open Backup UI v1.2.0
import { redirect } from 'next/navigation'
import { ActivityWorkspace } from '@/components/activity/activity-workspace'
import { getRequestI18n } from '@/lib/i18n/server'
import { validId } from '@/lib/investigation/model'

export async function generateMetadata() {
  const {t} = await getRequestI18n()
  return {title: `${t('Sessions')} | Open Backup UI`}
}

export default async function ActivityPage({searchParams}: {searchParams: Promise<{session?: string; name?: string}>}) {
  const {session,name} = await searchParams
  if (typeof session === 'string' && validId(session)) redirect(`/vbr/activity/${session.toLowerCase()}`)
  const initialSearch = typeof name === 'string' ? name.trim().slice(0, 200) : ''
  return <ActivityWorkspace key={initialSearch} initialSearch={initialSearch}/>
}
