'use client'
// Open Backup UI v1.3.0
import { CheckCheck, ClipboardList } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/components/providers/i18n-provider'
import type { JsonRecord } from '@/lib/vbm-recovery/model'
import type { RestoreAuditEntry } from '@/lib/vbm-recovery/restore-audit'
import { combineRestoreResults, restoreItemResults, type RestoreItemResult } from '@/lib/vbm-recovery/restore-results'
import { recoveryStatusTone } from './session-events'
import css from './workspace.module.css'
import feedback from './restore-feedback.module.css'

export const ProviderRestoreSummary = memo(function ProviderRestoreSummary({statistics, events, saved}: {
  statistics?: JsonRecord|null
  events?: JsonRecord[]
  saved?: RestoreAuditEntry['outcome']
}) {
  const items = useMemo(() => {
    const live = restoreItemResults(statistics, events || [])
    return live.length || !saved ? live : combineRestoreResults(saved.items, saved.counts.total)
  }, [statistics, events, saved])
  return <RestoreSummary items={items}/>
})

export function RestoreSummary({ items }: { items: RestoreItemResult[] }) {
  const { t } = useI18n()
  const [limit, setLimit] = useState(100)
  const showSource = items.some(item => item.source)
  const showTarget = items.some(item => item.target)
  const showPath = !showSource && !showTarget && items.some(item => item.path)
  return <section className={feedback.summary} aria-label={t('Restore summary')}>
    <h3 className={css.title}><CheckCheck size={16}/>{t('Restore summary')}</h3>
    {items.length === 0 && <p className={css.sub}>{t('Veeam has not reported per-item results.')}</p>}
    {items.length > 0 && <div className={css.eventScroll}>
        <table className={feedback.resultTable} aria-label={t('Restore summary')}>
          <thead><tr>
            <th scope="col">{t('Name')}</th><th scope="col">{t('Result')}</th>
            {showSource && <th scope="col">{t('Source')}</th>}{showTarget && <th scope="col">{t('Target')}</th>}
            {showPath && <th scope="col">{t('Path')}</th>}
          </tr></thead>
          <tbody>{items.slice(0, limit).map((item, index) => <tr key={index}>
            <td><strong>{item.name}</strong>
              {!showPath && item.path && item.path !== item.source && item.path !== item.target && <small>{t('Path')} · {item.path}</small>}
            </td>
            <td><span className={css.status} data-tone={recoveryStatusTone(item.result)}><i/>{t(item.result)}</span>
              {item.error && <small className={css.error}>{item.error}</small>}
              {item.warnings.map((warning, i) => <small key={i}>{warning}</small>)}
            </td>
            {showSource && <td>{item.source || '—'}</td>}{showTarget && <td>{item.target || '—'}</td>}
            {showPath && <td>{item.path || '—'}</td>}
          </tr>)}</tbody>
        </table>
    </div>}
    {items.length > limit && <Button size="sm" variant="outline" onClick={() => setLimit(value => value + 100)}>{t('Load more')}</Button>}
  </section>
}

const settingLabels: Record<string, string> = {
  originalMailboxFolder: 'Folder in the original mailbox',
  destination: 'Destination', mailbox: 'Target mailbox', folder: 'Target folder', siteURL: 'Target site URL',
  list: 'Target library or list', targetOneDriveId: 'Target OneDrive', applicationId: 'Application ID',
  impersonationAccountName: 'Impersonation account', officeRegion: 'Microsoft 365 region', officeOrganizationName: 'Destination organization',
  organizationName: 'Destination organization', casServer: 'Client Access server', documentAction: 'Existing documents',
  documentVersion: 'Versions to restore', documentLastVersionAction: 'Existing documents', fileVersion: 'Versions to restore',
  changedItems: 'Restore changed items', deletedItems: 'Restore missing items', markRestoredAsUnread: 'Mark restored items as unread',
  restoreChangedItems: 'Restore changed items', restoreMissingItems: 'Restore missing items', restoreChangedTabs: 'Restore changed tabs',
  restoreMissingTabs: 'Restore missing tabs', restorePermissions: 'Restore permissions', sendSharedLinksNotification: 'Notify users about restored shared links',
  excludeDrafts: 'Exclude drafts', excludeDeletedItems: 'Exclude deleted items', excludeInPlaceHoldItems: 'Exclude In-Place Hold items',
  excludeLitigationHoldItems: 'Exclude litigation hold items',
}
const statuses = { requested: 'Requested', accepted: 'Accepted', failed: 'Failed', unknown: 'Restore status unknown', notSubmitted: 'Not submitted' }
const authModes = { operator: 'Restore operator', deviceCode: 'Microsoft sign-in', credentials: 'Username and password', certificate: 'Application certificate' }
const choiceLabels: Record<string, string> = { original: 'Original location', alternate: 'Another location', Keep: 'Keep existing documents', Overwrite: 'Overwrite', Last: 'Latest version', All: 'All versions', Merge: 'Merge versions' }
const choiceSettings = new Set(['destination', 'documentAction', 'documentVersion', 'documentLastVersionAction', 'fileVersion'])

export function RestoreAuditLog({ entries, unavailable }: { entries: RestoreAuditEntry[]; unavailable?: boolean }) {
  const { t, formatDate } = useI18n()
  if (!entries.length && !unavailable) return null
  return <section className={feedback.audit} aria-label={t('Restore audit')}>
    <h3 className={css.title}><ClipboardList size={16}/>{t('Restore audit')}</h3>
    {unavailable && <p className={css.notice}>{t('Some restore audit records could not be loaded.')}</p>}
    {entries.map(entry => <details key={entry.id}>
      <summary><time dateTime={entry.submittedAt}>{formatDate(entry.submittedAt, {dateStyle:'medium',timeStyle:'medium'})}</time>
        <span>{entry.workload}</span><span className={css.sub}>{t(statuses[entry.status])}</span>
      </summary>
      <dl className={feedback.settings}>
        <div><dt>{t('Source')}</dt><dd>{entry.source}</dd></div>
        <div><dt>{t('Authentication')}</dt><dd>{t(authModes[entry.authMode])}</dd></div>
        <div><dt>{t('Request')}</dt><dd>{entry.requestId}</dd></div>
        {entry.sessionId && <div><dt>{t('Session ID')}</dt><dd>{entry.sessionId}</dd></div>}
        {entry.outcome && <div><dt>{t('Last updated')}</dt><dd><time dateTime={entry.outcome.observedAt}>{formatDate(entry.outcome.observedAt, {dateStyle:'medium', timeStyle:'medium'})}</time></dd></div>}
        {Object.entries(entry.settings).map(([key, value]) => <div key={key}><dt>{t(settingLabels[key] || key)}</dt><dd>
          {typeof value === 'boolean' ? t(value ? 'Yes' : 'No') : choiceSettings.has(key) && choiceLabels[value] ? t(choiceLabels[value]) : value}
        </dd></div>)}
      </dl>
      <h4>{t('Selected items')}</h4>
      <ul>{entry.selection.map((item, index) => <li key={index}>{item.name || item.id}{item.path && <small>{item.path}</small>}</li>)}</ul>
    </details>)}
  </section>
}
