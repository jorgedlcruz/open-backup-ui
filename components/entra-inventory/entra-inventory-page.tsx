'use client'
// Open Backup UI v1.3.0
import Link from 'next/link'
import { useState } from 'react'
import { Building2, CalendarClock, DatabaseBackup, Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import { Empty, Notice, Pager, Panel, SearchBox, Status, useEvidence, useRefresh } from '@/components/investigation/shared'
import { useI18n } from '@/components/providers/i18n-provider'
import { useDisplayFormat } from '@/components/providers/use-display-format'
import { Button } from '@/components/ui/button'
import { DataLoading } from '@/components/ui/data-loading'
import { SortableGrid } from '@/components/ui/sortable-grid'
import { applicationRequest } from '@/lib/api/application-request'
import type { EntraInventory } from '@/lib/entra-inventory/model'
import type { SortColumn } from '@/lib/grid-sort'
import { vbrError } from '@/lib/i18n/vbr-errors'
import { cn } from '@/lib/utils'
import ops from '@/components/operations/operations.module.css'
import styles from './inventory.module.css'

type Tenant = EntraInventory['tenants'][number]
const pageSize = 15
const tenantTitle = (tenant: Tenant) => tenant.name || tenant.description || tenant.azureTenantId || tenant.id
const columns: SortColumn<Tenant>[] = [
  { id: 'tenant', value: tenantTitle },
  { id: 'region', value: tenant => tenant.region },
  { id: 'repository', value: tenant => tenant.cacheRepositoryName || tenant.cacheRepositoryId },
  { id: 'jobs', value: tenant => tenant.backupJobs.length, kind: 'number' },
  { id: 'lastRun', value: tenant => tenant.lastRun?.time, kind: 'date' },
]
const loadInventory = (signal: AbortSignal) => applicationRequest<EntraInventory>('/api/vbr/entra-inventory', { signal })

const warningCoverage: Record<string, readonly [string, string]> = {
  partialTenants: ['Entra ID tenants', 'Partial collection'],
  partialJobs: ['Backup Jobs', 'Partial collection'],
  jobsUnavailable: ['Backup Jobs', 'Unavailable'],
  partialJobStates: ['Job states', 'Partial collection'],
  jobStatesUnavailable: ['Job states', 'Unavailable'],
  partialRepositories: ['Cache repository', 'Partial collection'],
  repositoriesUnavailable: ['Cache repository', 'Unavailable'],
  restorePointsUnavailable: ['Restore points', 'Unavailable'],
}

export function EntraInventoryPage() {
  const { t } = useI18n()
  const { revision, refresh } = useRefresh()
  const { data, error, loading } = useEvidence(loadInventory, revision)
  return <main className={ops.console}>
    <header className={ops.header}>
      <div><h1>{t('Microsoft Entra ID')}</h1>
        {data && !error && <span className={ops.source}><span className={ops.dot} />{data.sourceName}</span>}
      </div>
      <div className={ops.headerControls}>
        <Button variant="outline" size="sm" disabled={loading} onClick={refresh}>
          <RefreshCw aria-hidden className={loading ? 'animate-spin' : ''} />{t('Refresh')}
        </Button>
        {data && !error && <Button asChild size="sm"><Link href="/vbr/inventory/entra/add"><Plus aria-hidden />{t('Add tenant')}</Link></Button>}
      </div>
    </header>
    {error ? <Notice error>{vbrError(t, error)}</Notice> : data
      ? <EntraInventorySnapshot key={data.sourceKey} data={data} />
      : <DataLoading status={t('Loading Microsoft Entra ID inventory…')} />}
  </main>
}

export function EntraInventorySnapshot({ data }: { data: EntraInventory }) {
  const { t, formatNumber } = useI18n()
  const { date, label } = useDisplayFormat()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const search = query.trim().toLowerCase()
  const matching = data.tenants.filter(tenant => !search || [
    tenant.name, tenant.description, tenant.azureTenantId, tenant.id, tenant.region, tenant.cacheRepositoryName,
    ...tenant.backupJobs.map(job => job.name),
  ].some(value => value?.toLowerCase().includes(search)))
  const current = Math.min(page, Math.max(0, Math.ceil(matching.length / pageSize) - 1))
  const linked = data.tenants.filter(tenant => tenant.backupJobs.length > 0).length
  function count(value: number | null, complete: boolean) {
    if (value === null || (!complete && !value)) return t('Unknown')
    return complete ? formatNumber(value) : t('At least {count}', { count: formatNumber(value) })
  }

  return <>
    <div className={ops.metrics}>
      <Metric title={t('Entra ID tenants')} value={count(data.tenants.length, data.tenantInventoryComplete)} icon={Building2} />
      <Metric title={t('Tenants with a backup job')} value={count(data.jobsAvailable ? linked : null, data.tenantInventoryComplete && data.jobsComplete)} icon={ShieldCheck} />
      <Metric title={t('Directory backup jobs')} value={count(data.backupJobCount, data.jobsComplete)} icon={DatabaseBackup} />
      <Metric title={t('Latest restore point')} icon={CalendarClock} detail
        value={data.latestRestorePoint ? date(data.latestRestorePoint.creationTime) : data.restorePointsAvailable ? t('No restore points reported') : t('Unavailable')}
        note={data.latestRestorePoint?.name || undefined} />
    </div>
    {data.warnings.length > 0 && <details className={ops.warnings}>
      <summary>{t('{count} data coverage notices', { count: formatNumber(data.warnings.length) })}</summary>
      <ul>{data.warnings.map(code => {
        const coverage = warningCoverage[code]
        return <li key={code}>{coverage ? <>{t(coverage[0])} · {t(coverage[1])}</> : t('Partial evidence')}</li>
      })}</ul>
    </details>}
    <Panel title={t('Entra ID tenants')} action={data.tenants.length > 0 && <Button asChild size="sm" variant="outline">
      <Link href="/vbr/jobs/create-entraid?type=tenant">{t('Create a backup job')}</Link>
    </Button>}>
      {data.tenants.length > 0 && <div className={styles.search}><SearchBox label={t('Search tenants')} value={query}
        onChange={value => { setQuery(value); setPage(0) }} /></div>}
      {matching.length > 0 ? <>
        <div className={ops.tableScroll}>
          <SortableGrid rows={matching} columns={columns} onSortChange={() => setPage(0)}>{sorted =>
            <table className={cn(ops.table, styles.table)}>
              <thead><tr><th>{t('Tenant')}</th><th>{t('Region')}</th><th>{t('Cache repository')}</th><th>{t('Linked backup jobs')}</th><th>{t('Last run')}</th></tr></thead>
              <tbody>{sorted.slice(current * pageSize, (current + 1) * pageSize).map(tenant => {
                const title = tenantTitle(tenant)
                const directoryId = tenant.azureTenantId || tenant.id
                return <tr key={tenant.id}>
                  <td><strong>{title}</strong>
                    {tenant.description && tenant.description !== title && <div className={ops.subtext}>{tenant.description}</div>}
                    {directoryId !== title && <div className={ops.subtext}>{directoryId}</div>}
                  </td>
                  <td>{tenant.region ? label(tenant.region) : t('Not reported')}</td>
                  <td>{tenant.cacheRepositoryName || tenant.cacheRepositoryId || t('Not reported')}</td>
                  <td>{tenant.backupJobs.length ? <ul className={styles.jobs}>{tenant.backupJobs.map(job =>
                    <li key={job.id}><Link className={ops.textLink} href={'/vbr/jobs/' + encodeURIComponent(job.id)}>{job.name}</Link></li>
                  )}</ul> : data.jobsComplete ? t('None') : t('Unknown')}</td>
                  <td>{tenant.lastRun ? <>
                    <time dateTime={tenant.lastRun.time}>{date(tenant.lastRun.time)}</time>
                    <div className={ops.subtext}>{tenant.lastRun.jobName}</div>
                    {tenant.lastRun.result && <Status value={tenant.lastRun.result} />}
                  </> : data.jobStatesAvailable && data.jobStatesComplete && data.jobsComplete ? t('Not reported') : t('Unknown')}</td>
                </tr>
              })}</tbody>
            </table>
          }</SortableGrid>
        </div>
        <Pager page={current} count={matching.length} size={pageSize} onChange={setPage} label={t('Entra ID tenants')} />
      </> : <Empty>{data.tenants.length ? t('No tenants match your search.') : data.tenantInventoryComplete
        ? t('No tenants are registered on this VBR server.') : t('Partial collection')}</Empty>}
    </Panel>
    <footer className={ops.footer}><span><span className={ops.dot} />{t('Snapshot')} {date(data.fetchedAt)}</span></footer>
  </>
}

function Metric({ title, value, icon: Icon, note, detail }: {
  title: string; value: string; icon: typeof Building2; note?: string; detail?: boolean
}) {
  return <section className={cn(ops.metric, styles.metric)} aria-label={title}>
    <h2 className={ops.metricLabel}>{title}<Icon size={16} aria-hidden /></h2>
    <strong className={cn(ops.metricValue, detail && styles.detail)}>{value}</strong>
    {note && <p>{note}</p>}
  </section>
}
