'use client'

import Link from 'next/link'
import { SortableGrid } from '@/components/ui/sortable-grid'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, RefreshCw, ShieldCheck, AlertTriangle, Database, Clock3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { veeamApi } from '@/lib/api/veeam-client'
import { assessWorkload, type RecoveryPoint, type WorkloadEvidence } from '@/lib/resilience/model'

const formatTime = (time: string) => new Date(time).toLocaleString()
const flagged = (point: RecoveryPoint) => ['infected', 'suspicious'].includes(point.malwareStatus?.toLowerCase() || '')

export function WorkloadResilience({ id }: { id: string }) {
  const [evidence, setEvidence] = useState<WorkloadEvidence | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [rpo, setRpo] = useState(24)
  const [days, setDays] = useState(7)
  const [selected, setSelected] = useState<RecoveryPoint | null>(null)
  const [now, setNow] = useState(Date.now())
  const [page, setPage] = useState(0)
  const pointDetails = useRef<HTMLElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(false); setEvidence(null); setSelected(null); setPage(0)
    veeamApi.getWorkloadResilience(id, controller.signal).then(result => {
      if (!controller.signal.aborted) { setEvidence(result); setNow(Date.now()) }
    }).catch(() => { if (!controller.signal.aborted) setError(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, revision])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer) }, [])
  const assessment = useMemo(() => evidence ? assessWorkload(evidence, rpo, now) : null, [evidence, rpo, now])
  const start = now - days * 86400000
  const visiblePoints = useMemo(() => (evidence?.points || []).filter(p => Date.parse(p.creationTime) >= start && Date.parse(p.creationTime) <= now).sort((a, b) => Date.parse(b.creationTime) - Date.parse(a.creationTime)), [evidence, start, now])
  const lanes = useMemo(() => {
    const result = new Map<string, { name: string; points: RecoveryPoint[] }>()
    for (const point of evidence?.points || []) {
      const key = point.repositoryId || `unknown:${point.backupId}`
      if (!result.has(key)) result.set(key, { name: point.repositoryName || (point.repositoryId ? `Repository ${point.repositoryId}` : `Unresolved destination · ${point.backupId}`), points: [] })
    }
    for (const point of visiblePoints) result.get(point.repositoryId || `unknown:${point.backupId}`)?.points.push(point)
    return [...result.entries()]
  }, [evidence, visiblePoints])
  const selectPoint = useCallback((point: RecoveryPoint) => {
    setSelected(point)
    requestAnimationFrame(() => pointDetails.current?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }))
  }, [])
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visiblePoints.length / 50) - 1))
  return <main className="mx-auto w-full max-w-[1600px] space-y-6 p-4 md:p-8">
    <Link href="/vbr/topology" className="inline-flex items-center gap-2 text-[length:var(--breadcrumb-font-size)] leading-normal text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Protection topology</Link>
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="break-all text-3xl font-semibold">{evidence?.name || 'Workload assessment'}</h1><p className="mt-2 text-sm text-muted-foreground">{evidence?.platform} · Recovery evidence, copy coverage and protection gaps</p></div><Button variant="outline" disabled={loading} onClick={() => setRevision(v => v + 1)}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh evidence</Button></header>
    {loading && <p role="status" className="rounded-xl border p-12 text-center">Reading restore points and backup destinations…</p>}
    {error && <div role="alert" className="rounded-xl border border-destructive/40 p-6">Workload evidence could not be loaded. Check the source connection and permissions, then retry. This is not evidence of missing backups.</div>}
    {evidence && assessment && <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 p-4"><div><span className="text-sm font-medium">Exploratory protection policy</span><p className="text-xs text-muted-foreground">Local assessment only; changing this target does not change backup schedules.</p></div><label className="flex items-center gap-3 text-sm">Recovery-point target<select aria-label="Recovery-point target" value={rpo} onChange={e => setRpo(Number(e.target.value))} className="rounded-md border bg-background p-2">{[4, 12, 24, 48].map(h => <option key={h} value={h}>{h} hours</option>)}</select></label></div>
      {(evidence.warnings.length > 0 || !assessment.freshEvidence) && <div role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">{evidence.warnings.map(w => <p key={w}>{w}</p>)}{!assessment.freshEvidence && <p>Evidence is older than 15 minutes or its timestamp is invalid. Refresh before relying on the policy checks.</p>}</div>}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resilience summary">
        <div className="rounded-xl border bg-card p-5"><ShieldCheck className="mb-3 size-5 text-primary" /><p className="text-sm text-muted-foreground">Overall resilience score</p><p className="my-2 text-3xl font-semibold">{assessment.score === null ? 'Pending' : `${assessment.score}/100`}</p><p className="text-xs text-muted-foreground">Essential evidence is missing. {assessment.earned} of 100 possible policy points confirmed.</p></div>
        <div className="rounded-xl border bg-card p-5"><AlertTriangle className="mb-3 size-5 text-amber-500" /><p className="text-sm text-muted-foreground">Assessment status</p><p className="my-2 text-lg font-semibold">{assessment.status}</p><p className="text-xs text-muted-foreground">Evidence coverage: {assessment.knownWeight}% of weighted checks</p></div>
        <div className="rounded-xl border bg-card p-5"><Clock3 className="mb-3 size-5 text-sky-400" /><p className="text-sm text-muted-foreground">Latest observed recovery point</p><p className="my-2 text-lg font-semibold">{assessment.latest ? formatTime(assessment.latest.creationTime) : 'None observed'}</p><p className="text-xs text-muted-foreground">Freshness alone does not prove recoverability.</p></div>
        <div className="rounded-xl border bg-card p-5"><Database className="mb-3 size-5 text-teal-400" /><p className="text-sm text-muted-foreground">Repositories with recent points</p><p className="my-2 text-3xl font-semibold">{assessment.recentRepositories} <span className="text-sm text-muted-foreground">/ 2 target</span></p><p className="text-xs text-muted-foreground">Separate failure domains remain unverified.</p></div>
      </section>
      <section className="overflow-hidden rounded-xl border bg-card" aria-label="Restore-point timeline">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5"><div><h2 className="text-lg font-semibold">Restore points across repositories</h2><p className="text-xs text-muted-foreground">Blue: reported Clean · red: suspicious/infected · grey: other or unknown. Clean does not prove a completed scan.</p></div><label className="text-sm">Window <select aria-label="Timeline window" className="rounded-md border bg-background p-2" value={days} onChange={e => { setDays(Number(e.target.value)); setPage(0) }}>{[1, 7, 30].map(d => <option key={d} value={d}>{d} days</option>)}</select></label></div>
        <div className="overflow-x-auto p-5"><div className="min-w-[600px]">
          <div className="mb-3 ml-48 flex justify-between text-xs text-muted-foreground"><span>{formatTime(new Date(start).toISOString())}</span><span>Now</span></div>
          {lanes.map(([key, lane]) => <div key={key} className="grid grid-cols-[12rem_1fr] items-center border-t py-5"><div className="pr-3 text-sm"><p className="break-words font-medium">{lane.name}</p><p className="mt-1 text-xs text-muted-foreground">{lane.points.length} points in window</p></div><div className="relative h-12 rounded-md bg-muted/40">
            <div className="absolute inset-y-0 right-0 border-l border-dashed border-primary/50 bg-primary/5" style={{ width: `${Math.min(100, rpo / (days * 24) * 100)}%` }} title={`Within ${rpo}-hour target`} />
            {lane.points.map((point, index) => <button key={point.id} aria-label={`Restore point ${point.id}, ${formatTime(point.creationTime)}, ${point.malwareStatus || 'unknown status'}`} title={`${formatTime(point.creationTime)} · ${point.malwareStatus || 'Unknown'}`} onClick={() => selectPoint(point)} className={`absolute size-3 -translate-x-1/2 rounded-full border border-background focus-visible:outline-2 focus-visible:outline-ring ${flagged(point) ? 'bg-red-500' : point.malwareStatus === 'Clean' ? 'bg-sky-400' : 'bg-slate-400'}`} style={{ left: `${2 + (Date.parse(point.creationTime) - start) / (now - start) * 96}%`, top: `${8 + index % 3 * 12}px` }} />)}
          </div></div>)}
          {!lanes.length && <p className="py-8 text-sm text-muted-foreground">No restore points were returned for this backup object.</p>}
        </div></div>
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">Shaded area: target recovery window. Overlapping points can also be selected individually in the table below.</p>
      </section>
      <div className="grid items-start gap-6 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-xl border bg-card p-5"><h2 className="mb-4 text-lg font-semibold">Policy evidence</h2><div className="space-y-4">{assessment.checks.map(check => <div key={check.id} className="border-t pt-4"><div className="flex justify-between gap-3"><h3 className="font-medium">{check.label} <span className="text-xs text-muted-foreground">{check.weight} points</span></h3><span className={`text-sm ${check.state === 'pass' ? 'text-emerald-500' : check.state === 'fail' ? 'text-amber-500' : 'text-muted-foreground'}`}>{check.state === 'pass' ? 'Met' : check.state === 'fail' ? 'Gap' : 'Unknown'}</span></div><p className="mt-2 text-sm text-muted-foreground">{check.detail}</p></div>)}</div></section>
        <div className="space-y-5">
          <section ref={pointDetails} className="rounded-xl border bg-card p-5" aria-label="Selected restore point" aria-live="polite"><h2 className="text-lg font-semibold">Restore-point details</h2>{selected ? <dl className="mt-4 space-y-3 text-sm">{[['Created', formatTime(selected.creationTime)], ['Reported malware status', selected.malwareStatus || 'Unknown'], ['Type', selected.type || 'Unknown'], ['Repository', selected.repositoryName || selected.repositoryId || 'Unresolved'], ['Backup ID', selected.backupId], ['Point ID', selected.id]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-all">{value}</dd></div>)}</dl> : <p className="mt-3 text-sm text-muted-foreground">Select a timeline point or table row to inspect its evidence.</p>}</section>
          <section className="rounded-xl border bg-card p-5"><h2 className="text-lg font-semibold">Recommended next checks</h2><ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">{assessment.actions.slice(0, 4).map(action => <li key={action}>{action}</li>)}</ul></section>
          <section className="rounded-xl border border-dashed p-5"><h2 className="font-semibold">Backup sessions · TBD</h2><p className="mt-2 text-sm text-muted-foreground">Workload-level session parsing and correlation are pending. Job success will not be presented as proof of this workload’s recovery readiness.</p></section>
        </div>
      </div>
      <section className="overflow-hidden rounded-xl border bg-card"><h2 className="p-5 text-lg font-semibold">Restore-point evidence · {visiblePoints.length} in window</h2><div className="overflow-x-auto"><SortableGrid rows={visiblePoints} columns={[{id:'created',value:r=>r.creationTime,kind:'date'},{id:'repository',value:r=>r.repositoryName || r.repositoryId},{id:'type',value:r=>r.type},{id:'malware',value:r=>r.malwareStatus}]} onSortChange={()=>setPage(0)}>{(visiblePoints)=>(<table className="w-full text-left text-sm"><thead className="border-y bg-muted/20"><tr>{['Created (local time)', 'Repository', 'Type', 'Reported malware status'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{visiblePoints.slice(currentPage * 50, (currentPage + 1) * 50).map(point => <tr key={point.id} className="border-b"><td className="p-3"><button className="whitespace-nowrap text-primary underline-offset-4 hover:underline" onClick={() => selectPoint(point)}>{formatTime(point.creationTime)}</button></td><td className="p-3">{point.repositoryName || point.repositoryId || 'Unresolved'}</td><td className="p-3">{point.type || 'Unknown'}</td><td className={`p-3 ${flagged(point) ? 'text-red-500' : ''}`}>{point.malwareStatus || 'Unknown'}</td></tr>)}</tbody></table>)}</SortableGrid></div>{!visiblePoints.length && <p className="p-5 text-sm text-muted-foreground">No observed points in this time window.</p>}{visiblePoints.length > 50 && <div className="flex items-center justify-end gap-3 p-4"><span className="text-xs">Page {currentPage + 1} of {Math.ceil(visiblePoints.length / 50)}</span><Button variant="outline" size="sm" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={(currentPage + 1) * 50 >= visiblePoints.length} onClick={() => setPage(currentPage + 1)}>Next</Button></div>}</section>
      <footer className="space-y-2 text-xs text-muted-foreground"><p>{evidence.sourceName} · Evidence retrieved {formatTime(evidence.fetchedAt)} · Policy model v1</p><p>This assessment covers the selected VBR backup object and returned restore points. Other object identities, copies or unprotected infrastructure may be outside its scope. No inference is made from matching VM names.</p></footer>
    </>}
  </main>
}
