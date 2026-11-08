import { ActivityWorkspace } from '@/components/activity/activity-workspace'
import { getRequestI18n } from '@/lib/i18n/server'
import { validId } from '@/lib/investigation/model'

export async function generateMetadata() {
  const {t} = await getRequestI18n()
  return {title: `${t('Activity')} | Open Backup UI`}
}

export default async function ActivityPage({searchParams}: {searchParams: Promise<{session?: string}>}) {
  const {session} = await searchParams
  return <ActivityWorkspace initialSession={typeof session === 'string' && validId(session) ? session.toLowerCase() : undefined}/>
}
