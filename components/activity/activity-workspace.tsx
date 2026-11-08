'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, FileText, RefreshCw, Search } from 'lucide-react'
import { applicationRequest } from '@/lib/api/application-request'
import { historySize, type ActivityFeed, type ActivityRow } from '@/lib/activity/model'
import { useI18n } from '@/components/providers/i18n-provider'
import { investigationLabel } from '@/lib/investigation/presentation'
import { enumLabel, type Translator } from '@/lib/i18n/presentation'
import { Status } from '@/components/investigation/shared'
import { GuestFileBrowser } from '@/components/restore-points/guest-file-browser'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { MountControls } from './mount-controls'
import ops from '@/components/operations/operations.module.css'

function operationLabel(row: ActivityRow, t: Translator) {
  switch (row.mount?.kind) {
    case 'vSphere': return t('Instant VM Recovery') + ' · VMware vSphere'
    case 'hyperV': return t('Instant VM Recovery') + ' · Microsoft Hyper-V'
    case 'fcd': return t('First Class Disk Recovery')
    case 'other': return investigationLabel(t, row.mount.operation || 'Restore').replace(/([a-z])([A-Z])/g, '$1 $2')
    case 'publish': return t('Published disks')
    case 'flr': return t('Guest file restore')
    default: return investigationLabel(t, row.session?.sessionType || 'Unknown').replace(/([a-z])([A-Z])/g, '$1 $2')
  }
}

const mountLabels: Record<string,string> = {publish: 'Published disks', vSphere: 'VMware vSphere', hyperV: 'Microsoft Hyper-V', flr: 'Guest file restore', fcd: 'First Class Disk Recovery'}

function ActivityStatus({row}: {row: ActivityRow}) {
  const {t} = useI18n()
  if (!row.mount) return <Status value={row.state}/>
  const tone = row.state === 'Mounted' ? ops.success : row.state.includes('Failed') ? ops.danger : ops.active
  const text = row.state === 'MountFailed' ? t('Mount failed') : row.state === 'UnmountFailed' ? t('Unmount failed') : t(row.state)
  return <span className={ops.badge + ' ' + tone}><span className={ops.dot}/>{text}</span>
}

export function ActivityWorkspace({initialSession}: {initialSession?: string}) {
  const {t, formatDate, formatNumber} = useI18n()
  const [filter, setFilter] = useState('')
  const [name, setName] = useState('')
  const [state, setState] = useState('')
  const [skip, setSkip] = useState(0)
  const [focus, setFocus] = useState(initialSession)
  const [selection, setSelection] = useState<string|undefined>(initialSession)
  const [feed, setFeed] = useState<ActivityFeed>()
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => {setName(filter.trim()); setSkip(0)}, 300)
    return () => clearTimeout(timer)
  }, [filter])

  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    const params = new URLSearchParams({skip: String(skip), name, state})
    if (focus) params.set('session', focus)
    async function refresh() {
      if (pending) return
      pending = true
      setBusy(true)
      try {
        const result = await applicationRequest<ActivityFeed>(`/api/vbr/activity?${params}`, {signal: controller.signal})
        if (!controller.signal.aborted) {setFeed(result); setError('')}
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Activity could not be loaded.')
      } finally {
        pending = false
        if (!controller.signal.aborted) setBusy(false)
      }
    }
    void refresh()
    const timer = setInterval(() => {if (document.visibilityState === 'visible') void refresh()}, 15000)
    return () => {controller.abort(); clearInterval(timer)}
  }, [skip, name, state, focus, revision])
  const date = (value?: string|null) => value && Number.isFinite(Date.parse(value))
    ? formatDate(value, {dateStyle: 'medium', timeStyle: 'short'}) : '—'
  const rows = feed?.rows || []
  const selected = selection && rows.find(row => row.key === selection || row.sessionId === selection)
  const onAccepted = (sessionId?: string) => {
    setNotice(t('VBR accepted the request.'))
    setSelection(sessionId); setFocus(sessionId); setSkip(0); setRevision(value => value + 1)
  }
  return <main className={ops.console}>
    <header className={ops.header}>
      <div><h1>{t('Activity')}</h1><p>{t('Backup sessions, restores and mounted workloads.')}</p></div>
      <div className={ops.headerActions}>
        {feed && <span className={ops.source}>{feed.sourceName}</span>}
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setRevision(value => value + 1)}>
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''}/>{t('Refresh')}
        </Button>
      </div>
    </header>
    {error && <p role="alert" className={ops.notice}>{error}</p>}
    {notice && <p role="status" className={ops.notice}>{notice}</p>}
    {focus && feed && !busy && !selected && selection === focus && <p role="status" className={ops.notice}>
      {t('Waiting for VBR to report this session.')}
    </p>}
    {!!feed?.warnings.length && <div role="status" className={ops.warnings}>
      {t('Partial activity data')} · {feed.warnings.map(key => t(mountLabels[key] || key)).join(', ')}
    </div>}
    <section className={ops.panel} aria-label={t('Activity')}>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <label className="relative min-w-48 flex-1">
          <Search aria-hidden="true" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/>
          <Input className="pl-9" type="search" maxLength={200} value={filter} aria-label={t('Search sessions')}
            placeholder={t('Search sessions')} onChange={event => setFilter(event.target.value)}/>
        </label>
        <label className={ops.storageFilter}>{t('State')}
          <select value={state} onChange={event => {setSkip(0); setState(event.target.value)}}>
            <option value="">{t('All states')}</option>
            {['Starting', 'Working', 'Stopping', 'Stopped', 'ActionRequired'].map(value =>
              <option key={value} value={value}>{value === 'ActionRequired' ? t('Action required') : enumLabel(t, value)}</option>)}
          </select>
        </label>
      </div>
      {rows.length ? <div className="overflow-x-auto"><table className={ops.table}>
        <thead><tr>{['Name','Status','Started','Progress'].map(label => <th key={label} scope="col">{t(label)}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.key}>
          <td><button className={ops.jobName} onClick={() => setSelection(row.key)}>{row.name}</button>
            <div className={ops.subtext}>{operationLabel(row,t)}</div></td>
          <td><ActivityStatus row={row}/></td>
          <td className={ops.dateCell}>{date(row.session?.creationTime)}</td>
          <td>{row.session?.progressPercent == null ? '—' : formatNumber(row.session.progressPercent / 100, {style: 'percent'})}</td>
        </tr>)}</tbody>
      </table></div> : <div className={ops.empty}>{busy ? t('Loading…') : t('No matching sessions.')}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
        <span>{feed?.total == null ? '' : t('{count} sessions', {count: formatNumber(feed.total)})}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={busy || !skip} onClick={() => setSkip(Math.max(0, skip - historySize))}><ChevronLeft/>{t('Previous')}</Button>
          <Button size="sm" variant="outline" disabled={busy || !feed?.hasMore} onClick={() => setSkip(skip + historySize)}>{t('Next')}<ChevronRight/></Button>
        </div>
      </div>
    </section>
    <Dialog open={!!selected} onOpenChange={open => {if (!open) {setSelection(undefined); setFocus(undefined)}}}>
      {selected && feed && <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle className="break-words pr-6">{selected.name}</DialogTitle>
        <DialogDescription>{operationLabel(selected,t)}</DialogDescription>
        <div className="flex items-center justify-between gap-3"><ActivityStatus row={selected}/>
          {((selected.mount?.kind !== 'other' && selected.mount?.kind !== 'publish') || selected.session) && <Button asChild size="sm" variant="outline"><Link href={`/vbr/sessions/${selected.sessionId}`}><FileText/>{t('Session log')}</Link></Button>}
        </div>
        <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
          {[[t('Started'), date(selected.session?.creationTime)], [t('Finished'), date(selected.session?.endTime)],
            [t('Initiated by'), selected.session?.initiatedBy], [t('Host'), selected.mount?.host], [t('Backup'), selected.mount?.backup],
            [t('Restore point'), date(selected.mount?.pointTime)]].filter(([,value]) => value && value !== '—').map(([label,value]) =>
              <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd></div>)}
        </dl>
        {(selected.mount?.error || selected.session?.result?.message) && <p className="text-sm">{selected.mount?.error || selected.session?.result?.message}</p>}
        {selected.mount && !error && (selected.mount.kind === 'flr'
          ? <GuestFileBrowser key={selected.key} sessionId={selected.mount.sessionId} sourceKey={feed.sourceKey}/>
          : <MountControls key={feed.sourceKey + selected.key} mount={selected.mount} sourceKey={feed.sourceKey} onAccepted={onAccepted}/>)}
      </DialogContent>}
    </Dialog>
  </main>
}
