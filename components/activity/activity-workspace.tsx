'use client'
// Open Backup UI v1.0.2

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { veeamApi } from '@/lib/api/veeam-client'
import { sessionProgress, type ActivityFeed, type ActivityRow } from '@/lib/activity/model'
import { buildActivityParams, defaultFilters, sessionGroups, sessionPlatforms, sessionResults, sessionStates, sessionTypes, type ActivityQuery } from '@/lib/activity/filters'
import { useI18n } from '@/components/providers/i18n-provider'
import { investigationLabel } from '@/lib/investigation/presentation'
import { enumLabel, type Translator } from '@/lib/i18n/presentation'
import { SearchBox, Status } from '@/components/investigation/shared'
import { DataLoading } from '@/components/ui/data-loading'
import { FilterWorkspace } from '@/components/operations/filter-workspace'
import { FilterFields } from '@/components/operations/filter-fields'
import { FilterFacet, FilterSelect } from '@/components/operations/filter-facet'
import { Button } from '@/components/ui/button'
import ops from '@/components/operations/operations.module.css'

function sessionLabel(t: Translator, value: string) {
  return investigationLabel(t, value).replace(/([a-z])([A-Z])/g, '$1 $2')
}

function operationLabel(row: ActivityRow, t: Translator) {
  switch (row.mount?.kind) {
    case 'vSphere': return t('Instant VM Recovery') + ' · VMware vSphere'
    case 'hyperV': return t('Instant VM Recovery') + ' · Microsoft Hyper-V'
    case 'fcd': return t('First Class Disk Recovery')
    case 'other': return sessionLabel(t, row.mount.operation || 'Restore')
    case 'publish': return t('Published disks')
    case 'flr': return t('Guest file restore')
    default: return sessionLabel(t, row.session?.sessionType || 'Unknown')
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

function detailLink(row: ActivityRow, sourceKey: string) {
  const params = new URLSearchParams({sourceKey})
  if (row.mount) {params.set('mount', row.mount.id); params.set('kind', row.mount.kind)}
  return `/vbr/activity/${encodeURIComponent(row.sessionId)}?${params}`
}

export function ActivityWorkspace({initialSearch = ''}: {initialSearch?: string}) {
  const {t, formatDate, formatNumber} = useI18n()
  const [search, setSearch] = useState(initialSearch)
  const [filters, setFilters] = useState({...defaultFilters, name:initialSearch})
  const [offsets, setOffsets] = useState<{skip: number; before?: string}[]>([{skip:0}])
  const [snapshot, setSnapshot] = useState<{key: string; feed: ActivityFeed}>()
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const key = buildActivityParams({...filters, ...offsets[offsets.length - 1]}).toString()
  const feed = snapshot?.key === key ? snapshot.feed : undefined

  useEffect(() => {
    const timer = setTimeout(() => {setFilters(old => old.name === search.trim() ? old : {...old, name: search.trim()})}, 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    async function refresh() {
      if (pending) return
      pending = true
      setBusy(true)
      try {
        const data = await veeamApi.requestActivity<ActivityFeed>(`/api/vbr/activity?${key}`, {signal: controller.signal})
        if (!controller.signal.aborted) {setSnapshot({key, feed: data}); setError('')}
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Session history unavailable')
      } finally {
        pending = false
        if (!controller.signal.aborted) setBusy(false)
      }
    }
    void refresh()
    const timer = setInterval(() => {if (document.visibilityState === 'visible') void refresh()}, 15000)
    return () => {controller.abort(); clearInterval(timer)}
  }, [key, revision])

  function change(patch: Partial<ActivityQuery>) {
    setFilters(previous => ({...previous, ...patch})); setOffsets([{skip:0}])
  }
  const activeCount = Number(!!search.trim()) + Number(!!filters.group) + filters.types.length + filters.results.length +
    Number(!!filters.platform) + Number(!!filters.state) + Number(!!filters.window)
  const date = (value?: string|null) => value && Number.isFinite(Date.parse(value))
    ? formatDate(value, {dateStyle: 'medium', timeStyle: 'short'}) : '—'
  return <main className={ops.console}>
    <header className={ops.header}>
      <div><h1>{t('Sessions')}</h1><p>{t('Backup sessions, restores and mounted workloads.')}</p></div>
      <div className={ops.headerActions}>
        {feed && <span className={ops.source}>{feed.sourceName}</span>}
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setRevision(value => value + 1)}>
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''}/>{t('Refresh')}
        </Button>
      </div>
    </header>
    {error && <p role="alert" className={ops.notice}>{error === 'Session history unavailable' ? t('Session history unavailable') : error}</p>}
    {!!feed?.warnings.length && <div role="status" className={ops.warnings}>
      {t('Partial collection')} · {feed.warnings.map(key => t(mountLabels[key] || key)).join(', ')}
    </div>}
    <section className={ops.panel} aria-label={t('Sessions')}>
      <FilterWorkspace label="Grid filters" activeCount={activeCount}
        search={<SearchBox label={t('Search sessions')} value={search} onChange={value => {setSearch(value.slice(0, 200)); setOffsets([{skip:0}])}}/>}
        onClear={() => {setSearch(''); setFilters(defaultFilters); setOffsets([{skip:0}])}}
        filters={<FilterFields>
          <FilterSelect label="Category" value={filters.group} onValueChange={group => change({group, types: []})} defaultOpen>
            <option value="">{t('All')}</option>
            {Object.keys(sessionGroups).map(group => <option key={group} value={group}>{t(group === 'Recovery' ? 'Restore' : group)}</option>)}
          </FilterSelect>
          <FilterFacet title="Session type" options={(sessionGroups[filters.group] || sessionTypes).map(value =>
            ({value, label: sessionLabel(t, value), searchText: value}))} selected={filters.types} onChange={types => change({types})}/>
          <FilterSelect label="Platform" value={filters.platform} onValueChange={platform => change({platform})}>
            <option value="">{t('All platforms')}</option>
            {sessionPlatforms.map(value => <option key={value} value={value}>{enumLabel(t, value)}</option>)}
          </FilterSelect>
          <FilterFacet title="Session result" options={sessionResults.map(value => ({value, label: enumLabel(t, value)}))}
            selected={filters.results} onChange={results => change({results})}/>
          <FilterSelect label="State" value={filters.state} onValueChange={state => change({state})}>
            <option value="">{t('All states')}</option>
            {sessionStates.map(value => <option key={value} value={value}>{sessionLabel(t, value)}</option>)}
          </FilterSelect>
          <FilterSelect label="Started" value={filters.window} onValueChange={window => change({window})}>
            <option value="">{t('All')}</option><option value="24h">{t('Last 24 hours')}</option>
            <option value="7d">{t('Last 7 days')}</option><option value="30d">{t('Last 30 days')}</option>
          </FilterSelect>
        </FilterFields>}>
        {!feed && !error && <div className={ops.empty}>{snapshot ? t('Loading…') : <DataLoading status={t('Loading session history…')} compact/>}</div>}
        {feed && (feed.rows.length ? <div className={ops.tableScroll}><table className={ops.table}>
          <thead><tr>{['Name','Platform','Status','Started','Progress'].map(label => <th key={label} scope="col">{t(label)}</th>)}</tr></thead>
          <tbody>{feed.rows.map(row => {
            const progress = sessionProgress(row.session, row.mount)
            return <tr key={row.key}>
            <td><Link prefetch={false} className={ops.jobName} href={detailLink(row, feed.sourceKey)}>{row.name}</Link>
              <div className={ops.subtext}>{operationLabel(row,t)}</div></td>
            <td>{row.session?.platformName ? enumLabel(t, row.session.platformName) : '—'}</td>
            <td><ActivityStatus row={row}/></td>
            <td className={ops.dateCell}>{date(row.session?.creationTime)}</td>
            <td>{progress == null ? '—' : formatNumber(progress / 100, {style: 'percent'})}</td>
          </tr>})}</tbody>
        </table></div> : <div className={ops.empty}>{feed.hasMore
          ? t('No matches in this part of the history. Continue to older sessions.') : t('No matching sessions.')}</div>)}
        <div className={ops.pagination}>
          <span>{feed?.total == null || !feed.total && feed.rows.length ? '' : t('{count} sessions', {count: formatNumber(feed.total)})}</span>
          <div><Button size="sm" variant="outline" disabled={busy || offsets.length < 2}
            onClick={() => setOffsets(previous => previous.slice(0,-1))}><ChevronLeft/>{t('Previous')}</Button>
            <Button size="sm" variant="outline" disabled={busy || !feed?.hasMore}
              onClick={() => {if (feed) setOffsets(previous => [...previous, {skip: feed.nextSkip, before: feed.before}])}}>{t('Next')}<ChevronRight/></Button>
          </div>
        </div>
      </FilterWorkspace>
    </section>
  </main>
}
