export type CollectorStatus = {
  state: 'waiting' | 'running' | 'healthy' | 'partial' | 'error' | 'disabled' | 'unsupported' | 'stale'
  intervalMinutes: number
  lastAttempt: string | null
  lastSuccess: string | null
  nextAttempt: string | null
  repositories: number
  measured: number
  message: string
}

export const COLLECTION_INTERVAL = 15 * 60 * 1000
export function collectorDue(status: CollectorStatus | null, now: number) {
  const due = status?.nextAttempt ? Date.parse(status.nextAttempt) : NaN
  return !Number.isFinite(due) || due <= now
}
export function presentCollector(status: CollectorStatus | null, now: number, enabled: boolean, supported: boolean): CollectorStatus {
  const base:CollectorStatus = status || {state:'waiting',intervalMinutes:15,lastAttempt:null,lastSuccess:null,nextAttempt:null,repositories:0,measured:0,message:'Waiting for the first scheduled collection.'}
  if(!enabled)return {...base,state:'disabled',nextAttempt:null,message:'Background collection is disabled by CAPACITY_COLLECTOR_ENABLED=false.'}
  if(!supported)return {...base,state:'unsupported',nextAttempt:null,message:'Unattended collection requires a VBR source with saved server credentials. Browser-only sessions still record during refresh.'}
  if(base.nextAttempt && now > Date.parse(base.nextAttempt)+120000)return {...base,state:'stale',message:'The next collection is overdue. Check the app server and its data-directory access.'}
  return base
}
