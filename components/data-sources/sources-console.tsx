'use client'

import { useI18n } from '@/components/providers/i18n-provider'
import { SortableGrid } from '@/components/ui/sortable-grid'
import { useCallback, useEffect, useState } from 'react'
import { Empty, Loading, Notice, Pager, Panel, SearchBox, useEvidence } from '@/components/investigation/shared'
import { FilterWorkspace } from '@/components/operations/filter-workspace'
import { GridViewOptions } from '@/components/operations/grid-view-options'
import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import shared from '@/components/vbm-dashboard/vbm-dashboard.module.css'
import { Export } from '@/components/vbm-jobs/shared'
import { authLabels, connectionLabels, emptyFilters, filterRows, matches, platforms, stale, type Filters, type Row, type Snapshot } from '@/lib/data-sources/model'
import { sourceMessage } from '@/lib/data-sources/presentation'
import { cn } from '@/lib/utils'
import { Activity, Database, Edit2, ExternalLink, Plus, RefreshCw, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { SourceActionDialog, sourceRequest, type Action } from './source-actions'
import { SourceFilters } from './source-filters'
import styles from './sources.module.css'

const columns = [{ id: 'name', name: 'Data source' }, { id: 'connection', name: 'Connection health' }, { id: 'authentication', name: 'Authentication' }, { id: 'api', name: 'API / product version' }, { id: 'checked', name: 'Last checked' }, { id: 'configuration', name: 'Configuration' }]
function Connection({ row }: { row: Row }) {
  const { t, formatNumber } = useI18n(), h = row.health
  return <><span className={cn(ops.badge, h.connection === 'reachable' ? ops.success : h.connection === 'unreachable' ? ops.danger : ops.neutral)}>{t(connectionLabels[h.connection])}</span><p className={shared.sub}>{h.httpStatus !== null && `${t('HTTP {status}', { status: h.httpStatus })} · `}{h.latencyMs !== null ? t('{value} ms', { value: formatNumber(h.latencyMs) }) : t('No response sample')}</p>{h.httpStatus !== null && h.httpStatus >= 500 && <p className={cn(shared.sub, ops.warning)}>{t('API service error')}</p>}</>
}
function Authentication({ row }: { row: Row }) {
  const { t } = useI18n()
  return <><span className={cn(ops.badge, row.health.authentication === 'verified' ? ops.success : ['required', 'rejected', 'forbidden'].includes(row.health.authentication) ? ops.warning : ops.neutral)}>{t(authLabels[row.health.authentication])}</span><p className={shared.sub}>{t(row.hasCredentials ? 'Saved credentials available' : 'No saved credentials')}</p></>
}
export function SourcesConsole() {
  const { t, formatNumber, formatDate } = useI18n()
  const date = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? formatDate(value, { dateStyle: 'medium', timeStyle: 'short' }) : t('Not reported')
  const [, setClock] = useState(0)
  useEffect(() => { const timer = setInterval(() => setClock(value => value + 1), 60000); return () => clearInterval(timer) }, [])
  const [revision, setRevision] = useState(0), [filters, setFilters] = useState<Filters>(emptyFilters), [visible, setVisible] = useState(columns.map(item => item.id)), [page, setPage] = useState(0), [action, setAction] = useState<Action | null>(null), [selected, setSelected] = useState<string | null>(null), [checks, setChecks] = useState<Record<string, Row>>({}), [checking, setChecking] = useState<string | null>(null), [checkError, setCheckError] = useState<string | null>(null)
  const load = useCallback((signal: AbortSignal) => sourceRequest('?check=1', 'GET', undefined, signal) as Promise<Snapshot>, []), { data, error, loading } = useEvidence(load, revision)
  const refresh = () => { setChecks({}); setRevision(value => value + 1) }, update = (patch: Partial<Filters>) => { setFilters(old => ({ ...old, ...patch })); setPage(0) }
  const all = (data?.sources || []).map(row => checks[row.id] || row), rows = filterRows(all, filters), current = Math.min(page, Math.max(0, Math.ceil(rows.length / 10) - 1)), detail = all.find(row => row.id === selected), fresh = all.filter(row => !stale(row)), healthy = fresh.filter(row => row.health.api === 'verified' && row.health.authentication === 'verified')
  async function check(row: Row) {
    if (checking || loading) return
    setChecking(row.id); setCheckError(null)
    try { const result: Snapshot = await sourceRequest(`?check=1&id=${encodeURIComponent(row.id)}`); setChecks(old => ({ ...old, [row.id]: result.sources[0] })) }
    catch (error) { setCheckError(error instanceof Error ? error.message : 'Check failed.') }
    finally { setChecking(null) }
  }
  const actions = (row: Row) => <div className={styles.rowActions}>
    <Button size="sm" variant="outline" disabled={loading || !!checking} onClick={() => void check(row)} aria-label={t('Check connection for {name}', { name: row.name })}><RefreshCw size={13} className={checking === row.id ? 'animate-spin' : ''} />{t('Check')}</Button>
    <Button size="sm" variant="outline" onClick={() => setAction({ type: 'connect', row })} aria-label={t('Connect {name}', { name: row.name })}>{t(row.selected ? 'Reconnect' : 'Connect')}</Button>
    {row.selected && <Button size="sm" variant="ghost" onClick={() => setAction({ type: 'disconnect', row })} aria-label={t('Disconnect {name}', { name: row.name })}>{t('Disconnect')}</Button>}
    <Button size="icon" variant="ghost" aria-label={t('Edit {name}', { name: row.name })} title={t(row.managed === 'environment' ? 'Managed in server environment' : 'Edit source')} disabled={row.managed === 'environment'} onClick={() => setAction({ type: 'edit', row })}><Edit2 size={14} /></Button>
    <Button size="icon" variant="ghost" aria-label={t('Remove {name}', { name: row.name })} disabled={row.managed === 'environment'} onClick={() => setAction({ type: 'remove', row })}><Trash2 size={14} /></Button>
  </div>
  const facts = detail ? [
    ['Platform', platforms[detail.type].name], ['Connection', t(connectionLabels[detail.health.connection])], ['Authentication', t(authLabels[detail.health.authentication])],
    ['Browser session', t(detail.selected ? 'Selected' : 'Not selected')], ['Account', detail.username || t('Not saved')], ['Credentials', t(detail.hasCredentials ? 'Stored on the server' : 'Not saved')],
    ['API used by this check', detail.health.apiVersion || t('Not verified')], ['Configured API', detail.health.expectedApi || t('Not implemented')],
    ['Product build', detail.health.productVersion || t('Not reported')], ['Server name', detail.health.serverName || t('Not reported')], ['Server platform', detail.health.serverPlatform || t('Not reported')],
    ['Check endpoint', detail.health.probePath || t('Not implemented')], ['Last checked', date(detail.health.checkedAt)], ['Last token issued', date(detail.health.lastAuthenticated)], ['Cached token expiry', date(detail.health.tokenExpiresAt)],
    ['Source ID', detail.id], ['Configuration', t(detail.managed === 'environment' ? 'Managed through server environment' : 'Saved on application server')],
    ['Response time', detail.health.latencyMs === null ? t('Not measured') : t('{value} ms', { value: formatNumber(detail.health.latencyMs) })],
  ] : []
  return <div className={cn(ops.console, styles.page)}>
    <header className={ops.header}><div><h1>{t('Data Sources')}</h1><p className={ops.subtitle}>{t('Verify platform access, investigate connection issues and manage the sources behind your operations views.')}</p></div><div className={styles.toolbar}><Button variant="outline" size="sm" disabled={loading || !!checking} onClick={refresh}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />{t('Check all connections')}</Button><Button size="sm" onClick={() => setAction({ type: 'add' })}><Plus size={14} />{t('Add Data Source')}</Button></div></header>
    {(error || checkError) && <Notice error>{sourceMessage(t, error || checkError || '')}{data && ` ${t('Previous evidence remains visible.')}`}</Notice>}
    {loading && data && <p className={shared.refreshing} role="status">{t('Checking connections · previous evidence remains visible.')}</p>}
    {!data && loading ? <Loading>{t('Checking configured endpoints and API access…')}</Loading> : <>
      <dl className={styles.healthSummary} aria-label={t('Source health summary')}>
        <div><dt><Database size={14} />{t('Configured sources')}</dt><dd><strong>{formatNumber(all.length)}</strong><span>{t('{platforms} platforms · {selections} browser selections', { platforms: formatNumber(new Set(all.map(row => row.type)).size), selections: formatNumber(all.filter(row => row.selected).length) })}</span></dd></div>
        <div><dt><Activity size={14} />{t('Verified API access')}</dt><dd><strong className={ops.success}>{formatNumber(healthy.length)}</strong><span>{t('Authenticated checks within five minutes')}</span></dd></div>
        <div><dt><ShieldCheck size={14} />{t('Authentication / access')}</dt><dd><strong className={all.some(row => matches(row, 'authentication')) ? ops.warning : undefined}>{formatNumber(all.filter(row => matches(row, 'authentication')).length)}</strong><span>{t('Sign-in, token or permission issues')}</span></dd></div>
        <div><dt><ShieldAlert size={14} />{t('Need investigation')}</dt><dd><strong className={all.some(row => matches(row, 'attention')) ? ops.warning : undefined}>{formatNumber(all.filter(row => matches(row, 'attention')).length)}</strong><span>{t('Connection, compatibility or unknown evidence')}</span></dd></div>
      </dl>
      <section className={cn(ops.panel, styles.inventory)} aria-label={t('Data Sources')}>
        <FilterWorkspace label={t('Data source filters')} activeCount={Number(!!filters.query) + Number(filters.issue !== 'all') + Number(filters.platform !== 'all') + Number(filters.managed !== 'all')} onClear={() => { setFilters({ ...emptyFilters, sort: filters.sort }); setPage(0) }}
          search={<SearchBox label={t('Search sources, endpoints, accounts or versions')} value={filters.query} onChange={query => update({ query })} />}
          filters={<SourceFilters rows={all} filters={filters} onChange={update} />}
          actions={<><GridViewOptions columns={columns.map(column => ({ ...column, name: t(column.name) }))} visible={visible} onChange={setVisible} order={{ value: filters.sort, options: [{ value: 'name', label: t('Name') }, { value: 'issues', label: t('Issues first') }, { value: 'latency', label: t('Slowest response') }], onChange: value => update({ sort: value as Filters['sort'] }) }} /><Export rows={rows} name="data-sources" /></>}>
          <div className={styles.resultSummary}><span role="status">{t('{shown} of {total} sources', { shown: formatNumber(rows.length), total: formatNumber(all.length) })}</span><span>{t('Select a source to inspect its latest check')}</span></div>
          {rows.length ? <div className={ops.tableScroll} role="region" aria-label={t('Data source connections')} tabIndex={0}><SortableGrid rows={rows} columns={columns.filter(column => visible.includes(column.id)).map(column => ({ id: column.id, kind: column.id === 'checked' ? 'date' as const : 'auto' as const, value: (r: typeof rows[number]) => ({ name: r.name, connection: r.health.connection, authentication: r.health.authentication, api: r.health.apiVersion, checked: r.health.checkedAt, configuration: r.managed } as Record<string, unknown>)[column.id] }))} key={filters.sort} onSortChange={() => setPage(0)}>{rows => (<table className={cn(ops.table, styles.table)} style={{ minWidth: Math.max(560, visible.length * 150 + 250) }}><thead><tr>{columns.filter(column => visible.includes(column.id)).map(column => <th key={column.id}>{t(column.name)}</th>)}<th>{t('Actions')}</th></tr></thead><tbody>{rows.slice(current * 10, current * 10 + 10).map(row => <tr key={row.id}>
            {visible.includes('name') && <td><button className={styles.name} onClick={() => setSelected(row.id)} aria-label={t('Investigate {name}', { name: row.name })}>{row.name}</button><p className={shared.sub}>{platforms[row.type].name}</p>{row.name !== row.url && <p className={shared.sub}>{row.url}</p>}<p className={styles.selection}>{t(row.selected ? 'Selected in this browser' : 'Not selected in this browser')}</p></td>}
            {visible.includes('connection') && <td><Connection row={row} />{stale(row) && <p className={cn(shared.sub, ops.warning)}>{t('Check needed')}</p>}</td>}
            {visible.includes('authentication') && <td><Authentication row={row} /><p className={shared.sub}>{row.username || t('Account not saved')}</p></td>}
            {visible.includes('api') && <td><strong>{row.health.apiVersion || t('Not verified')}</strong><p className={shared.sub}>{row.health.api === 'verified' ? t('API verified by request') : row.health.api === 'unsupported' ? t('API compatibility review') : t('Configured API: {version}', { version: row.health.expectedApi || t('Not implemented') })}</p><p className={shared.sub}>{t('Product {version}', { version: row.health.productVersion || t('build not reported') })}</p></td>}
            {visible.includes('checked') && <td>{date(row.health.checkedAt)}</td>}{visible.includes('configuration') && <td><span className={cn(ops.badge, ops.neutral)}>{t(row.managed === 'environment' ? 'Environment' : 'Saved on server')}</span><p className={shared.sub}>{t(new URL(row.url).protocol === 'https:' ? 'HTTPS endpoint' : 'HTTP endpoint')}</p>{row.health.api !== 'verified' && <p className={shared.sub}>{sourceMessage(t, row.health.detail)}</p>}</td>}
            <td>{actions(row)}</td>
          </tr>)}</tbody></table>)}</SortableGrid></div> : <Empty>{t(all.length ? 'No data sources match these filters.' : 'No data sources configured. Add a source to begin.')}</Empty>}
          <Pager page={current} count={rows.length} size={10} onChange={setPage} label={t('data sources')} /><p className={ops.panelFoot}>{t('Checks are point-in-time reads from the application server. A reachable endpoint can still deny access or report a service error. API versions describe the request that succeeded; product builds are shown only when returned. Neither indicates that all operations or backups are healthy.')}</p>
        </FilterWorkspace>
      </section>
      {detail && <Panel title={t('Source investigation · {name}', { name: detail.name })} subtitle={detail.url} action={<Button size="sm" variant="ghost" onClick={() => setSelected(null)}>{t('Close investigation')}</Button>}><dl className={styles.facts}>{facts.map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>)}</dl><p className={styles.detailNote}>{sourceMessage(t, detail.health.detail)}{' '}{t('Token expiry is the current cached token’s expiry, not the credential expiration date; server integrations can renew it.')}</p><div className={styles.detailNote}>{actions(detail)}<Link className={ops.textLink} href={platforms[detail.type].home}>{t('Open platform view')}<ExternalLink size={12} /></Link></div></Panel>}
      {all.some(row => row.managed === 'environment') && <Notice>{t('Environment-managed sources remain visible and can be checked or connected. Edit their endpoint and credentials in the server environment.')}</Notice>}
    </>}
    <footer className={ops.footer}><span><span className={ops.dot} />{t('Inventory')} {date(data?.fetchedAt)} · {t('{count} configured sources', { count: formatNumber(all.length) })}</span><Link className={ops.textLink} href="/connect">{t('Connection portal')}<ExternalLink size={12} /></Link></footer>
    {action && <SourceActionDialog action={action} onClose={() => setAction(null)} onComplete={refresh} />}
  </div>
}
