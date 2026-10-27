import type { OperationRepository } from '../operations/model'
import { utilization } from '../operations/model'
import { DAY, type Observation } from './model'

/** Hourly measurements, bounded to 90 days and 20,000 records per authenticated source. */
export function mergeObservations(previous: Observation[], repositories: OperationRepository[], now: number): Observation[] {
  const rows = new Map<string,Observation>()
  const key = (o:Observation) => `${o.id}:${Math.floor(Date.parse(o.at)/3600000)}`
  for(const o of previous) if(Number.isFinite(Date.parse(o.at)) && Date.parse(o.at)>=now-90*DAY && Date.parse(o.at)<=now && o.capacityGB>0 && o.freeGB>=0 && o.freeGB<=o.capacityGB) rows.set(key(o),o)
  for(const r of repositories) if(utilization(r)!==null && r.type!=='ScaleOut') {
    const o={id:r.id.toLowerCase(),at:new Date(now).toISOString(),capacityGB:r.capacityGB!,freeGB:r.freeGB!}
    rows.set(key(o),o)
  }
  return [...rows.values()].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).slice(-20000)
}
