'use client'
// Open Backup UI v1.2.0
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { time } from '@/lib/investigation/model'
import { repositoryIssues, status, type Snapshot } from '@/lib/vbm-dashboard/model'
import { retention } from '@/lib/vbm-repositories/model'
import { Tone } from './session-history'
import { Field } from './evidence-panels'
import { useDashboardPresentation } from './presentation'
import ops from '@/components/operations/operations.module.css'
import styles from './vbm-dashboard.module.css'
export type Selection = { kind: 'job' | 'session' | 'repository'; id: string } | null

export function InvestigationDialog({ data, selected, onSelect }: { data: Snapshot; selected: Selection; onSelect: (selected: Selection) => void }) {
  const { t, number, date, bytes, label, value, orgName, repoName } = useDashboardPresentation()
  const boolean = (value?: boolean | null) => value == null ? t('Not reported') : value ? t('Yes') : t('No')
  const job = selected?.kind === 'job' ? data.jobs.data.find(row => row.id === selected.id) : undefined
  const session = selected?.kind === 'session' ? data.sessions.data.find(row => row.id === selected.id) : undefined
  const repo = selected?.kind === 'repository' ? data.repositories.data.find(row => row.id === selected.id) : undefined
  const rate = (value?: number | null) => t('{size}/s', { size: bytes(value) })
  return <Dialog open={!!selected} onOpenChange={open => { if (!open) onSelect(null) }}>
    <DialogContent className={styles.dialog}>
      <DialogHeader>
        <DialogTitle>{job?.name || repo?.name || (session ? data.jobs.data.find(job => job.id === session.jobId)?.name || t('Session investigation') : t('Evidence unavailable'))}</DialogTitle>
        <DialogDescription>{t(job ? 'Current job configuration and recorded session evidence.' : session ? 'Full reported session result and processing details.' : 'Repository capacity, consumption, and linked jobs.')}</DialogDescription>
      </DialogHeader>
      {job && <>
        <div className={styles.actions}><Tone value={status(job.lastStatus)}/><Tone value={job.isEnabled === true ? 'Enabled' : job.isEnabled === false ? 'Disabled' : 'Not reported'}/></div>
        <p className={styles.message}>{job.description || t('Description not reported')}</p>
        <dl className={styles.facts}>
          <Field label="Job ID">{job.id}</Field><Field label="Backup type">{label(job.backupType)}</Field>
          <Field label="Organization">{orgName(data, job.organizationId)}</Field><Field label="Repository">{repoName(data, job.repositoryId)}</Field>
          <Field label="Last run">{date(job.lastRun)}</Field><Field label="Last backup">{date(job.lastBackup)}</Field><Field label="Next run">{date(job.nextRun)}</Field>
          <Field label="Schedule">{label(job.schedulePolicy?.scheduleEnabled == null ? 'Not reported' : job.schedulePolicy.scheduleEnabled ? 'Enabled' : 'Disabled')} · {label(job.schedulePolicy?.type)}</Field>
          <Field label="Retries">{job.schedulePolicy?.retryEnabled == null ? t('Not reported') : job.schedulePolicy.retryEnabled ? t('{count} configured', { count: number(job.schedulePolicy.retryNumber) }) : t('Disabled')}</Field>
        </dl>
        <h3>{t('Recent session evidence · {days} days', { days: number(data.days) })}</h3>
        <div className={styles.evidence}>{data.sessions.data.filter(row => row.jobId === job.id).sort((a, b) => (time(b.creationTime) ?? 0) - (time(a.creationTime) ?? 0)).slice(0, 5).map(session =>
          <button key={session.id} onClick={() => onSelect({ kind: 'session', id: session.id })}><span><Tone value={status(session.status)}/>{date(session.creationTime)}<ArrowUpRight size={13}/></span><p>{session.details || t('No message reported')}</p></button>
        )}{!data.sessions.data.some(row => row.jobId === job.id) && <p>{t('No session evidence loaded for this job.')}</p>}</div>
        <Link className={ops.textLink} href={`/vbm/jobs/${encodeURIComponent(job.id)}/sessions`}>{t('Open job sessions')}<ArrowUpRight size={14}/></Link>
        <Link className={ops.textLink} href="/vbm/jobs">{t('Manage jobs and available actions')}<ArrowUpRight size={14}/></Link>
      </>}
      {session && <>
        <Tone value={status(session.status)}/><p className={styles.message}>{session.details || t('No result message reported.')}</p>
        <dl className={styles.facts}>
          <Field label="Session ID">{session.id}</Field><Field label="Job ID">{value(session.jobId)}</Field><Field label="Session type">{label(session.jobType)}</Field>
          <Field label="Repository">{repoName(data, session.repositoryId)}</Field><Field label="Created">{date(session.creationTime)}</Field><Field label="Ended">{date(session.endTime)}</Field>
          <Field label="Progress (API value)">{number(session.progress)}</Field><Field label="Retry count">{number(session.retryCount)}</Field><Field label="Retry pending">{boolean(session.jobWillBeRetried)}</Field>
          <Field label="Main session ID">{value(session.mainSessionId)}</Field><Field label="Transferred data">{bytes(session.statistics?.transferredDataBytes)}</Field><Field label="Processed objects">{number(session.statistics?.processedObjects)}</Field>
          <Field label="Processing rate">{t('{bytes} · {count} items/s', { bytes: rate(session.statistics?.processingRateBytesPS), count: number(session.statistics?.processingRateItemsPS) })}</Field>
          <Field label="Read / write rates">{rate(session.statistics?.readRateBytesPS)} · {rate(session.statistics?.writeRateBytesPS)}</Field><Field label="Bottleneck">{label(session.statistics?.bottleneck)}</Field>
        </dl>
        {session.jobId && <Link className={ops.textLink} href={`/vbm/jobs/${encodeURIComponent(session.jobId)}/sessions`}>{t('Open job session history')}<ArrowUpRight size={14}/></Link>}
      </>}
      {repo && <>
        <p className={styles.message}>{repo.description || t('Description not reported')}{repo.outOfOrderReason ? `\n${repo.outOfOrderReason}` : ''}</p>
        <dl className={styles.facts}>
          <Field label="Repository ID">{repo.id}</Field><Field label="Path">{value(repo.path)}</Field>
          <Field label="Reported issues">{repositoryIssues(repo, data).map(label).join(' · ') || t('No issues reported in loaded evidence')}</Field>
          <Field label="Local disk capacity / free">{bytes(repo.capacityBytes)} / {bytes(repo.freeSpaceBytes)}</Field><Field label="Object storage type">{label(repo.objectStorage?.type)}</Field>
          <Field label="Object used / quota headroom">{bytes(repo.objectStorage?.usedSpaceBytes)} / {repo.objectStorage?.sizeLimitEnabled === true ? bytes(repo.objectStorage?.freeSpaceBytes) : t('No finite quota reported')}</Field>
          <Field label="Configured quota (API GB)">{repo.objectStorage?.sizeLimitEnabled == null ? t('Not reported') : repo.objectStorage.sizeLimitEnabled ? t('{count} GB', { count: number(repo.objectStorage.sizeLimitGB) }) : t('Disabled')}</Field>
          <Field label="Immutability">{repo.objectStorage?.enableImmutability == null ? t('Not reported') : repo.objectStorage.enableImmutability ? t('Enabled · API period: {days} days', { days: number(repo.objectStorage.immutabilityPeriodDays) }) : t('Disabled')}</Field>
          <Field label="Governance mode">{boolean(repo.objectStorage?.enableImmutabilityGovernanceMode)}</Field>
          <Field label="Retention">{label(repo.retentionType)} · {label(retention(repo))}</Field>
        </dl>
        <h3>{t('Directly assigned jobs')}</h3>
        <div className={styles.evidence}>{data.jobs.data.filter(job => job.repositoryId === repo.id).map(job => <button key={job.id} onClick={() => onSelect({ kind: 'job', id: job.id })}><span>{job.name || job.id}<Tone value={status(job.lastStatus)}/><ArrowUpRight size={13}/></span></button>)}{!data.jobs.data.some(job => job.repositoryId === repo.id) && <p>{t('No direct job targets in loaded evidence.')}</p>}</div>
        <p className={ops.subtext}>{t('Immutability describes configuration, not validation of every stored object. Local disk and object-storage quota are separate measurements.')}</p>
        <Link className={ops.textLink} href="/vbm/infrastructure/repositories">{t('Manage repositories')}<ArrowUpRight size={14}/></Link>
      </>}
    </DialogContent>
  </Dialog>
}
