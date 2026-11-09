"use client"
import { Trans, useI18n } from "@/components/providers/i18n-provider"
import { investigationAttempt, investigationDiagnostic, investigationDuration, investigationLabel, investigationRate } from '@/lib/investigation/presentation'
import type { Session } from '@/lib/investigation/model'
import { FilterSelect } from '@/components/operations/filter-facet'
import { FilterFields,GridViewMenu } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import ops from '@/components/operations/operations.module.css'
import { Button } from '@/components/ui/button'
import { time,tone,type Logs } from '@/lib/investigation/model'
import { cn } from '@/lib/utils'
import { ArrowDownToLine,ChevronLeft,ChevronRight,Loader2,Search,TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useEffect,useState,type ReactNode } from 'react'
import styles from './investigation.module.css'

export const date = (value?: string | null) => time(value) === null ? 'Not reported' : new Date(value!).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
export function useInvestigationPresentation() {
  const context = useI18n(), { t, formatNumber, formatDate } = context
  return { ...context,
    date: (value?: string | null) => time(value) === null ? t('Not reported') : formatDate(value!, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    label: (value?: string | null) => investigationLabel(t, value),
    rate: (value?: string | null) => investigationRate(t, value),
    notice: (value: string) => investigationDiagnostic(t, value),
    attemptLabel: (session: Session) => investigationAttempt(t, session, formatNumber),
    duration: (record: Pick<Session, 'creationTime' | 'endTime' | 'progress'>) => investigationDuration(t, record, formatNumber),
    bytes: (value?: number | null) => {
      if (value == null || !Number.isFinite(value) || value < 0) return t('Not reported')
      const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'], power = value === 0 ? 0 : Math.max(0, Math.min(5, Math.floor(Math.log(value) / Math.log(1024))))
      return `${formatNumber(value / 1024 ** power, { maximumFractionDigits: 2 })} ${units[power]}`
    },
  }
}
export function Status({ value }: { value: string }) {
  const { t } = useI18n()
  return <span className={cn(ops.badge, ops[tone(value)])}><span className={ops.dot} />{investigationLabel(t, value)}</span>
}
export function Panel({ title, subtitle, action, children, className }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  const { t } = useI18n()
  return <section aria-label={t(title)} className={cn(ops.panel, className)}><div className={ops.panelHeading}><div><h2><Trans>{title}</Trans></h2>{subtitle && <p><Trans>{subtitle}</Trans></p>}</div>{action}</div>{children}</section>
}
export function Empty({ children }: { children: ReactNode }) { return <div className={ops.empty}>{children}</div> }
export function Loading({ children }: { children?: ReactNode }) { const { t } = useI18n(); return <div className={ops.empty} role="status"><Loader2 size={20} className="animate-spin" />{children ?? t('Loading investigation…')}</div> }
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div role={error ? 'alert' : 'status'} className={cn(ops.notice, styles.notice)}><TriangleAlert size={17} /><div>{children}</div>{error && <Link href="/connect"><Trans>{"Connection"}</Trans></Link>}</div>
}
export function Pager({ page, count, size = 10, onChange, label }: { page: number; count: number; size?: number; onChange: (page: number) => void; label: string }) {
  const { t, formatNumber } = useI18n()
  const pages = Math.max(1, Math.ceil(count / size))
  return <div className={ops.pagination}><span>{count ? t('{start}–{end} of {count}', { start: formatNumber(page * size + 1), end: formatNumber(Math.min((page + 1) * size, count)), count: formatNumber(count) }) : t('0 records')}</span><div><Button size="icon" variant="ghost" aria-label={t('Previous {label}', { label: t(label) })} disabled={page === 0} onClick={() => onChange(page - 1)}><ChevronLeft size={15} /></Button><span>{formatNumber(page + 1)} / {formatNumber(pages)}</span><Button size="icon" variant="ghost" aria-label={t('Next {label}', { label: t(label) })} disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}><ChevronRight size={15} /></Button></div></div>
}
export function SearchBox({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { t } = useI18n()
  return <label className={cn(ops.search, styles.search)}><Search size={15} /><input aria-label={t(label)} placeholder={t(label)} value={value} onChange={e => onChange(e.target.value)} /></label>
}
export function useEvidence<T>(load: (signal: AbortSignal) => Promise<T>, revision: number) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(null)
    load(controller.signal).then(value => { if (!controller.signal.aborted) setData(value) })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Investigation data could not be loaded.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [load, revision])
  return { data, error, loading }
}
export function useRefresh() {
  const [revision, setRevision] = useState(0)
  useEffect(() => { const timer = setInterval(() => { if (!document.hidden) setRevision(n => n + 1) }, 60000); return () => clearInterval(timer) }, [])
  return { revision, refresh: () => setRevision(n => n + 1) }
}
export function LogViewer({ logs, title, id, newestFirst = false }: { logs: Logs; title: string; id: string; newestFirst?: boolean }) {
  const { t, formatNumber, date, notice } = useInvestigationPresentation()
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [order, setOrder] = useState(newestFirst ? 'newest' : 'oldest'), [page, setPage] = useState(0)
  const rows = logs.data.filter(row => (filter === 'all' || (filter === 'issues' ? ['Failed', 'Warning'].includes(row.status || '') : row.status === filter)) &&
    [row.title, row.description, ...(row.additionalInfo || []).flatMap(info => [info.field, info.data])].join(' ').toLowerCase().includes(query.toLowerCase()))
    .map((row, index) => ({ ...row, key: index })).sort((a, b) => {
      const at = time(a.startTime), bt = time(b.startTime)
      if (at === null) return bt === null ? 0 : 1
      if (bt === null) return -1
      return (at - bt || (a.id ?? 0) - (b.id ?? 0)) * (order === 'oldest' ? 1 : -1)
    })
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 20) - 1))
  const issues = logs.data.filter(row => ['Failed', 'Warning'].includes(row.status || '')).length
  function download() {
    const text = [`${title} · ${id}`, `${rows.length} filtered records; ${logs.data.length} loaded; total ${logs.total ?? 'not reported'}; complete: ${logs.complete}`, ...rows.map(row =>
      `${row.startTime || 'Time not reported'} [${row.status || 'Not reported'}] ${row.title || ''}\n${row.description || ''}${(row.additionalInfo || []).map(info => `\n${info.field || t('Field')}: ${info.data ?? t('Not reported')}`).join('')}`)].join('\n\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `vbr-${id}-logs.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  if (!logs.available) return <Notice>{logs.error ? notice(logs.error) : t('Logs unavailable for this session.')} <Trans>{"Use Refresh to try again."}</Trans></Notice>
  return <div className={styles.logViewer}>
    <div className={styles.logSummary}><span>{t('{count} records loaded · {issues} errors / warnings', { count: formatNumber(logs.data.length), issues: formatNumber(issues) })}</span><Button variant="outline" size="sm" onClick={download} disabled={!rows.length}><ArrowDownToLine size={14} /><Trans>{"Export filtered log"}</Trans></Button></div>
    {!logs.complete && <Notice>{logs.total == null ? t('Partial log: {count} records loaded; total not reported. Counts and export cover loaded records only.', { count: formatNumber(logs.data.length) }) : t('Partial log: showing {count} of {total} records. Counts and export cover loaded records only.', { count: formatNumber(logs.data.length), total: formatNumber(logs.total) })}</Notice>}
    <FilterWorkspace label="Grid filters" search={<><SearchBox label="Search log messages" value={query} onChange={v => { setQuery(v); setPage(0) }} /></>} onClear={()=>{setQuery('');setFilter('all');setPage(0)}} filters={<FilterFields><FilterSelect label={"Log severity"} value={filter} onValueChange={e => { setFilter(e); setPage(0) }}><option value="all"><Trans>{"All severities"}</Trans></option><option value="issues"><Trans>{"Errors & warnings"}</Trans></option><option value="Failed"><Trans>{"Failed"}</Trans></option><option value="Warning"><Trans>{"Warning"}</Trans></option><option value="Succeeded"><Trans>{"Succeeded"}</Trans></option><option value="None"><Trans>{"No status"}</Trans></option></FilterSelect></FilterFields>} actions={<><GridViewMenu><select aria-label={t("Log order")} value={order} onChange={e => { setOrder(e.target.value); setPage(0) }}><option value="oldest"><Trans>{"Oldest first"}</Trans></option><option value="newest"><Trans>{"Newest first"}</Trans></option></select></GridViewMenu></>}>
{rows.length ? <div className={styles.logs} role="region" aria-label={title}>{rows.slice(current * 20, current * 20 + 20).map(row => <article key={row.key} className={styles.logRecord}>
      <div className={styles.logMeta}><Status value={row.status === 'None' ? 'No status' : row.status || 'Not reported'} /><time>{date(row.startTime)}</time>{row.id != null && <span>#{row.id}</span>}</div>
      <div><p className={styles.logTitle}>{row.title || t('Untitled record')}</p>{row.description && <p className={styles.logDescription}>{row.description}</p>}{!!row.additionalInfo?.length && <details><summary><Trans>{"Additional information"}</Trans></summary><dl>{row.additionalInfo.map((info, index) => <div key={index}><dt>{info.field || t('Field')}</dt><dd>{info.data ?? t('Not reported')}</dd></div>)}</dl></details>}{row.updateTime && row.updateTime !== row.startTime && <small>{t('Updated {date}', { date: date(row.updateTime) })}</small>}</div>
    </article>)}</div> : <Empty>{logs.data.length ? t('No log records match these filters.') : t('VBR returned no log records for this session.')}</Empty>}
<Pager page={current} count={rows.length} size={20} onChange={setPage} label="log records" />
</FilterWorkspace></div>
}
