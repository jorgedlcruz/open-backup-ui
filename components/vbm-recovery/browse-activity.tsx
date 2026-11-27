'use client'
// Open Backup UI v1.3.0
import { useI18n } from '@/components/providers/i18n-provider'
import type { BrowseActivityEvent,BrowseActivityAvailability } from '@/lib/vbm-recovery/browse-activity'
import css from './workspace.module.css'
import feedback from './restore-feedback.module.css'

export function BrowseActivityLog({events,availability}:{events:BrowseActivityEvent[];availability?:BrowseActivityAvailability}) {
  const {t,formatDate}=useI18n()
  if (!events.length && availability!=='unavailable') return null
  return <details className={css.historyDisclosure}>
    <summary>{t('Open Backup UI activity')}</summary>
    <p className={css.sub}>{t('Successful backup reads recorded by this application. Veeam session events are shown above.')}</p>
    <p className={css.sub}>{t('Showing up to 500 reads from the last 24 hours. Earlier browsing is not reconstructed.')}</p>
    {availability==='unavailable'&&<p className={css.notice}>{t('Some application activity could not be recorded or loaded. Browsing remains available.')}</p>}
    {events.length>0 && <div className={css.eventScroll}><table className={css.eventTable} aria-label={t('Open Backup UI activity')}>
      <thead><tr><th>{t('Time')}</th><th>{t('Activity')}</th><th>{t('Location')}</th><th>{t('Items')}</th><th>{t('Read time')}</th></tr></thead>
      <tbody>{events.map(event=><tr key={event.id}><td className={css.cellDate}><time dateTime={event.timestamp}>{formatDate(event.timestamp,{dateStyle:'medium',timeStyle:'medium'})}</time></td><td>{t(event.action)}</td><td><span>{[event.objectName,event.parentName].filter(Boolean).join(' / ')||t(event.resourceKind==='owners'?'Backup inventory':'Selected object')}</span><details className={feedback.activityDetails}><summary>{t('Details')}</summary><dl><dt>{t('Source')}</dt><dd>{event.source}</dd>{event.actor&&<><dt>{t('Source account')}</dt><dd>{event.actor}</dd></>}{event.itemId&&<><dt>{t('Item ID')}</dt><dd>{event.itemId}</dd></>}{event.sessionCheckMs!==undefined&&<><dt>{t('Session validation')}</dt><dd>{event.sessionCheckMs} ms</dd></>}{event.sourceReadMs!==undefined&&<><dt>{t('Source read')}</dt><dd>{event.sourceReadMs} ms</dd></>}{event.ownerId&&<><dt>{t('Object ID')}</dt><dd>{event.ownerId}</dd></>}{event.parentId&&<><dt>{t('Parent ID')}</dt><dd>{event.parentId}</dd></>}</dl></details></td><td>{event.itemCount}</td><td className={css.cellDate}>{event.durationMs} ms{event.cached && <> · {t('Cached')}</>}</td></tr>)}</tbody>
    </table></div>}
  </details>
}
