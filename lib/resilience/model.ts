export interface RecoveryPoint {
  id: string; backupId: string; creationTime: string; type?: string; malwareStatus?: string
  repositoryId?: string; repositoryName?: string
}
export interface WorkloadEvidence {
  id: string; name: string; platform?: string; sourceName: string; fetchedAt: string
  points: RecoveryPoint[]; complete: boolean; warnings: string[]
}
export interface PolicyCheck { id: string; label: string; weight: number; state: 'pass' | 'fail' | 'unknown'; detail: string; action: string }

// A policy assessment, never a probability of recovery. Unknown weights stay unknown.
export function assessWorkload(evidence: WorkloadEvidence, rpoHours = 24, now = Date.now()) {
  if (!Number.isFinite(rpoHours) || rpoHours <= 0) throw new Error('RPO must be positive')
  const age = (p: RecoveryPoint) => now - Date.parse(p.creationTime)
  const valid = evidence.points.filter(p => Number.isFinite(age(p)) && age(p) >= 0)
  const recent = valid.filter(p => age(p) <= rpoHours * 3600000)
  const datesValid = valid.length === evidence.points.length
  const freshEvidence = now >= Date.parse(evidence.fetchedAt) && now - Date.parse(evidence.fetchedAt) <= 15 * 60000
  const complete = evidence.complete && datesValid && freshEvidence
  const repositories = new Set(recent.map(p => p.repositoryId).filter(Boolean))
  const mapped = evidence.points.every(p => !!p.repositoryId)
  const threat = evidence.points.some(p => ['infected', 'suspicious'].includes(p.malwareStatus?.toLowerCase() || ''))
  const checks: PolicyCheck[] = [
    { id: 'freshness', label: 'Recovery-point freshness', weight: 25,
      state: !freshEvidence ? 'unknown' : recent.length ? 'pass' : complete ? 'fail' : 'unknown',
      detail: `${recent.length} observed point(s) within ${rpoHours} hours.`, action: 'Check the workload schedule and latest backup result.' },
    { id: 'copies', label: 'Two recent repository copies', weight: 20,
      state: !freshEvidence ? 'unknown' : repositories.size >= 2 ? 'pass' : complete && mapped ? 'fail' : 'unknown',
      detail: `${repositories.size} distinct repository ID(s) with a recent point. Failure-domain independence is unverified.`, action: 'Check backup-copy freshness and destination coverage.' },
    { id: 'immutability', label: 'Deletion resistance', weight: 20, state: 'unknown', detail: 'Point-level immutable-until or offline-copy evidence is not integrated.', action: 'Verify protection of a qualifying recovery copy.' },
    { id: 'malware', label: 'Malware assessment', weight: 15, state: threat && freshEvidence ? 'fail' : 'unknown', detail: threat ? 'A returned point is marked suspicious or infected. This does not establish that every copy is affected.' : 'Reported Clean labels do not establish scan coverage, recency or provenance.', action: threat ? 'Review flagged points and confirm scan coverage before selecting a recovery candidate.' : 'Confirm malware scan coverage and provenance for a recovery candidate.' },
    { id: 'verification', label: 'Recovery verification', weight: 15, state: 'unknown', detail: 'Recovery-test and application-test evidence is not integrated.', action: 'Verify a recent recovery test against the workload recovery objective.' },
    { id: 'retention', label: 'Retention coverage', weight: 5, state: 'unknown', detail: 'Retention targets and expected recovery intervals are not configured.', action: 'Define the required retention window and acceptable gaps.' },
  ]
  const knownWeight = checks.filter(c => c.state !== 'unknown').reduce((sum, c) => sum + c.weight, 0)
  const earned = checks.filter(c => c.state === 'pass').reduce((sum, c) => sum + c.weight, 0)
  const failed = checks.filter(c => c.state === 'fail')
  return { checks, knownWeight, earned, score: knownWeight === 100 ? earned : null, threat,
    status: threat ? 'Security review required' : failed.length ? 'Protection gaps found' : 'Assessment incomplete',
    actions: [...failed, ...checks.filter(c => c.state === 'unknown')].map(c => c.action),
    latest: [...valid].sort((a, b) => Date.parse(b.creationTime) - Date.parse(a.creationTime))[0] || null,
    recentRepositories: repositories.size, freshEvidence }
}
