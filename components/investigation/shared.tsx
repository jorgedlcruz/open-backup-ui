"use client"
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
export function Status({ value }: { value: string }) {
  return <span className={cn(ops.badge, ops[tone(value)])}><span className={ops.dot} />{value}</span>
}
export function Panel({ title, subtitle, action, children, className }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section aria-label={title} className={cn(ops.panel, className)}><div className={ops.panelHeading}><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>
}
export function Empty({ children }: { children: ReactNode }) { return <div className={ops.empty}>{children}</div> }
export function Loading({ children = 'Loading investigation…' }: { children?: ReactNode }) { return <div className={ops.empty} role="status"><Loader2 size={20} className="animate-spin" />{children}</div> }
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div role={error ? 'alert' : 'status'} className={cn(ops.notice, styles.notice)}><TriangleAlert size={17} /><div>{children}</div>{error && <Link href="/connect">Connection</Link>}</div>
}
export function Pager({ page, count, size = 10, onChange, label }: { page: number; count: number; size?: number; onChange: (page: number) => void; label: string }) {
  const pages = Math.max(1, Math.ceil(count / size))
  return <div className={ops.pagination}><span>{count ? `${page * size + 1}–${Math.min((page + 1) * size, count)} of ${count}` : '0 records'}</span><div><Button size="icon" variant="ghost" aria-label={`Previous ${label}`} disabled={page === 0} onClick={() => onChange(page - 1)}><ChevronLeft size={15} /></Button><span>{page + 1} / {pages}</span><Button size="icon" variant="ghost" aria-label={`Next ${label}`} disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}><ChevronRight size={15} /></Button></div></div>
}
export function SearchBox({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className={cn(ops.search, styles.search)}><Search size={15} /><input aria-label={label} placeholder={label} value={value} onChange={e => onChange(e.target.value)} /></label>
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
export function LogViewer({ logs, title, id }: { logs: Logs; title: string; id: string }) {
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [order, setOrder] = useState('oldest'), [page, setPage] = useState(0)
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
      `${row.startTime || 'Time not reported'} [${row.status || 'Not reported'}] ${row.title || ''}\n${row.description || ''}${(row.additionalInfo || []).map(info => `\n${info.field || 'Field'}: ${info.data ?? 'Not reported'}`).join('')}`)].join('\n\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `vbr-${id}-logs.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  if (!logs.available) return <Notice>{logs.error || 'Logs unavailable for this session.'} Use Refresh to try again.</Notice>
  return <div>
    <div className={styles.logSummary}><span><strong>{logs.data.length}</strong> records loaded · <strong>{issues}</strong> errors / warnings</span><Button variant="outline" size="sm" onClick={download} disabled={!rows.length}><ArrowDownToLine size={14} /> Export filtered log</Button></div>
    {!logs.complete && <Notice>Partial log: showing {logs.data.length} of {logs.total ?? 'an unreported number of'} records. Counts and export cover loaded records only.</Notice>}
    <FilterWorkspace label="Grid filters" search={<><SearchBox label="Search log messages" value={query} onChange={v => { setQuery(v); setPage(0) }} /></>} onClear={()=>{setQuery('');setFilter('all');setPage(0)}} filters={<FilterFields><FilterSelect label={"Log severity"} value={filter} onValueChange={e => { setFilter(e); setPage(0) }}><option value="all">All severities</option><option value="issues">Errors & warnings</option><option value="Failed">Failed</option><option value="Warning">Warning</option><option value="Succeeded">Succeeded</option><option value="None">No status</option></FilterSelect></FilterFields>} actions={<><GridViewMenu><select aria-label="Log order" value={order} onChange={e => { setOrder(e.target.value); setPage(0) }}><option value="oldest">Oldest first</option><option value="newest">Newest first</option></select></GridViewMenu></>}>
{rows.length ? <div className={styles.logs} role="region" aria-label={title}>{rows.slice(current * 20, current * 20 + 20).map(row => <article key={row.key} className={styles.logRecord}>
      <div className={styles.logMeta}><Status value={row.status === 'None' ? 'No status' : row.status || 'Not reported'} /><time>{date(row.startTime)}</time>{row.id != null && <span>#{row.id}</span>}</div>
      <div><p className={styles.logTitle}>{row.title || 'Untitled record'}</p>{row.description && <p className={styles.logDescription}>{row.description}</p>}{!!row.additionalInfo?.length && <details><summary>Additional information</summary><dl>{row.additionalInfo.map((info, index) => <div key={index}><dt>{info.field || 'Field'}</dt><dd>{info.data ?? 'Not reported'}</dd></div>)}</dl></details>}{row.updateTime && row.updateTime !== row.startTime && <small>Updated {date(row.updateTime)}</small>}</div>
    </article>)}</div> : <Empty>{logs.data.length ? 'No log records match these filters.' : 'VBR returned no log records for this session.'}</Empty>}
<Pager page={current} count={rows.length} size={20} onChange={setPage} label="log records" />
</FilterWorkspace></div>
}
