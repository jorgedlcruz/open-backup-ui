import { unchecked, platforms, type Row, type Health, type Platform } from '@/lib/data-sources/model'

// Deliberately fixed sample evidence: comparisons stay identical on every visit.
export const demoNow = Date.parse('2026-10-25T09:45:00Z')
function source(id: string, name: string, type: Platform, patch: Partial<Health> = {}, managed: Row['managed'] = 'saved'): Row {
  return {
    id, name, type, url: `https://${id}.example.test:${platforms[type].port}`, username: 'sample-operator',
    hasCredentials: true, managed, selected: true,
    health: { ...unchecked(type), connection: 'reachable', authentication: 'verified', api: 'verified',
      checkedAt: '2026-10-25T09:44:00Z', latencyMs: 84, httpStatus: 200,
      apiVersion: platforms[type].api, detail: 'Authenticated API check succeeded.', ...patch },
  }
}
export const demoSources: Row[] = [
  source('vbr-london', 'London production', 'vbr'),
  source('vbr-dr', 'Disaster recovery', 'vbr', { connection: 'unreachable', authentication: 'unknown', api: 'unknown', apiVersion: null, httpStatus: null, latencyMs: null, checkedAt: '2026-10-25T09:43:00Z', detail: 'The endpoint did not respond.' }),
  source('m365-eu', 'Microsoft 365 Europe', 'vb365', { latencyMs: 132 }),
  source('one-analytics', 'ONE analytics', 'one', { authentication: 'required', api: 'unknown', apiVersion: null, httpStatus: 401, detail: 'Sign in to verify API access.' }),
  source('vro-recovery', 'Recovery orchestration', 'vro', { latencyMs: 105, checkedAt: '2026-10-25T09:42:00Z' }, 'environment'),
  { ...source('vbr-lab', 'Lab environment', 'vbr', unchecked('vbr'), 'environment'), hasCredentials: false, selected: false },
  source('m365-us', 'Microsoft 365 US', 'vb365', { authentication: 'rejected', api: 'unknown', httpStatus: 401, apiVersion: null, latencyMs: 210, detail: 'Authentication was rejected.' }),
  source('vbr-edge', 'Edge site', 'vbr', { latencyMs: 156, checkedAt: '2026-10-25T09:41:00Z' }),
]
