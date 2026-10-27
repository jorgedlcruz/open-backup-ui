import { z } from 'zod'
import type { RepositoryState, RepositoryConfig, Backup, File, ScaleOut } from '../repositories/model'
import type { Collection } from '../operations/model'
import type { CollectorStatus } from './collector'

const text = z.string().nullish(), bool = z.boolean().nullish()
const weekly = z.object({ isEnabled: bool, days: z.array(z.string()).nullish() }).nullish()
const full = z.object({ isEnabled: bool, weekly, monthly: z.object({ isEnabled: bool }).nullish() }).nullish()
// Only planning fields leave the server. Guest credentials, scripts and account settings are stripped.
export const policySchema = z.object({
  id: z.string().transform(s => s.toLowerCase()), name: text, type: text, isDisabled: bool,
  schedule: z.object({ runAutomatically: bool, daily: z.object({ isEnabled: bool, dailyKind: text, days: z.array(z.string()).nullish() }).nullish(),
    monthly: z.object({ isEnabled: bool }).nullish(), periodically: z.object({ isEnabled: bool }).nullish(),
    continuously: z.object({ isEnabled: bool }).nullish(), afterThisJob: z.object({ isEnabled: bool }).nullish() }).nullish(),
  storage: z.object({ backupRepositoryId: text,
    retentionPolicy: z.object({ type: text, quantity: z.number().nullish() }).nullish(),
    gfsPolicy: z.object({ isEnabled: bool }).nullish(),
    advancedSettings: z.object({ backupModeType: text, syntheticFulls: full, activeFulls: full }).nullish(),
  }).nullish(),
})
export const objectSchema = z.object({ id: z.string().transform(s => s.toLowerCase()), name: text, backupId: text.transform(s => s?.toLowerCase()), restorePointsCount: z.number().nullish(), platformName: text })
export type Policy = z.infer<typeof policySchema>
export type Workload = z.infer<typeof objectSchema>
export type ForecastFile = File & { name?: string | null; gfsPeriods?: string[] | null }
export type BackupPlan = Backup & { files: ForecastFile[]; complete: boolean; issue?: string; workloads?: Workload[]; latestPoint?: {state:'verified'|'empty'|'unavailable';at:string|null;reason?:string} }
export type Observation = { at: string; id: string; capacityGB: number; freeGB: number }
export type ForecastSnapshot = {
  sourceName: string; fetchedAt: string; warnings: string[];
  repositories: Collection<RepositoryState>; configs: Collection<RepositoryConfig>; scaleOut: Collection<ScaleOut>;
  policies: Collection<Policy>; objects: Collection<Workload>; backups: Collection<BackupPlan>;
  observations: Observation[]; historyAvailable: boolean; collector?: CollectorStatus;
}
export const DAY = 86400000, GB = 1024 ** 3
const weekdays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const validTime = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null
export const dayStart = (time: number) => Math.floor(time / DAY) * DAY
export const median = (values: number[]) => { const s = [...values].sort((a,b) => a-b), m = Math.floor(s.length / 2); return s.length ? s.length % 2 ? s[m] : (s[m-1]+s[m])/2 : null }
const size = (n?: number | null): n is number => n != null && Number.isSafeInteger(n) && n >= 0
export function uniqueFiles(files: ForecastFile[]) {
  const map = new Map<string, ForecastFile>(), conflicts = new Set<string>()
  for (const file of files) {
    const old = map.get(file.id)
    if (old && (old.backupId !== file.backupId || old.backupSize !== file.backupSize || old.creationTime !== file.creationTime || [...old.objectIds || []].sort().join() !== [...file.objectIds || []].sort().join())) conflicts.add(file.id)
    else map.set(file.id, file)
  }
  conflicts.forEach(id => map.delete(id))
  return { files: [...map.values()], conflicts: conflicts.size, conflictingIds: [...conflicts] }
}
export function policyLabel(policy?: Policy) {
  const retention = policy?.storage?.retentionPolicy
  return retention?.quantity && ['Days','RestorePoints'].includes(retention.type || '') ? `${retention.quantity} ${retention.type === 'Days' ? 'days' : 'restore points'}` : 'Retention not reported'
}
export function scheduleLabel(policy?: Policy) {
  if (policy?.isDisabled === true || policy?.schedule?.runAutomatically === false) return 'Automatic runs disabled'
  const daily = policy?.schedule?.daily
  if (!daily?.isEnabled) return 'Schedule not modeled'
  return daily.dailyKind === 'Everyday' ? 'Daily' : daily.dailyKind === 'WeekDays' ? 'Weekdays' : daily.days?.join(', ') || 'Schedule not reported'
}
export function fullLabel(policy?: Policy) {
  const a = policy?.storage?.advancedSettings
  if (!a) return 'Full schedule not reported'
  return [['Synthetic', a.syntheticFulls], ['Active', a.activeFulls]].flatMap(([name, value]) => {
    const f = value as NonNullable<typeof a>['syntheticFulls']
    return f?.isEnabled ? [`${name}: ${f.monthly?.isEnabled ? 'monthly' : f.weekly?.days?.join(', ') || 'schedule unknown'}`] : []
  }).join(' · ') || (a.syntheticFulls?.isEnabled === false && a.activeFulls?.isEnabled === false ? 'Forever forward incremental' : 'Full schedule not reported')
}
type Point = { at: number; bytes: number; hold: boolean }
type Chain = { points: Point[]; hold: boolean }
export type Projection = { values: { at: number; bytes: number; peak: number; fulls: number }[]; reason?: string; notes: string[]; incremental: number | null; current: number | null; modeledFileIds?: string[]; excludedFiles?: number }

/** File-footprint scenario, never a reconstruction of physical allocation. Whole chains expire together. */
function projectChainBackup(backup: BackupPlan, policy: Policy | undefined, config: RepositoryConfig | undefined, now: number, horizon: number, changePercent = 0, retentionOverride?: number): Projection {
  const dedup = uniqueFiles(backup.files), files = dedup.files
  const known = files.filter(f => size(f.backupSize)), current = known.length ? known.reduce((sum,f) => sum + f.backupSize!, 0) : null
  const notes: string[] = []
  const unavailable = (reason: string): Projection => ({ values: [], reason, notes, incremental: null, current })
  if (!backup.complete || dedup.conflicts || known.length !== files.length || !files.length) return unavailable('Complete, unambiguous file sizes are required')
  if (!policy) return unavailable('Job policy unavailable or job no longer exists')
  if (policy.isDisabled === true || policy.schedule?.runAutomatically === false) return unavailable('Automatic runs disabled; manual runs and background retention are not predictable')
  if (!['VSphereBackup','HyperVBackup'].includes(policy.type || '')) return unavailable('This job type is not yet modeled')
  const schedule = policy.schedule, daily = schedule?.daily, a = policy.storage?.advancedSettings, retention = policy.storage?.retentionPolicy
  if (schedule?.runAutomatically !== true || daily?.isEnabled !== true || [schedule?.monthly, schedule?.periodically, schedule?.continuously, schedule?.afterThisJob].some(s => s?.isEnabled)) return unavailable('Requires one daily or selected-weekday schedule')
  const runDays = daily.dailyKind === 'Everyday' ? weekdays : daily.dailyKind === 'WeekDays' ? weekdays.slice(1,6) : daily.dailyKind === 'SelectedDays' ? daily.days : null
  if (!runDays?.length || runDays.some(d => !weekdays.includes(d))) return unavailable('Daily schedule is incomplete')
  if (a?.backupModeType !== 'Incremental') return unavailable('Requires forward incremental backup mode')
  const fullDays: string[] = []
  for (const f of [a.syntheticFulls, a.activeFulls]) {
    if (f?.isEnabled == null) return unavailable('Full-backup settings are incomplete')
    if (!f.isEnabled) continue
    if (f.monthly?.isEnabled || !f.weekly?.isEnabled || !f.weekly.days?.length || f.weekly.days.some(d => !weekdays.includes(d))) return unavailable('Monthly or incomplete full schedules are not yet modeled')
    fullDays.push(...f.weekly.days)
  }
  const quantity = retentionOverride ?? retention?.quantity
  if (!quantity || !Number.isInteger(quantity) || quantity < 1 || !['Days','RestorePoints'].includes(retention?.type || '')) return unavailable('Retention policy is incomplete')
  // Only known, ordinary Linux local storage permits modeled expiry. Other backends
  // may use shared blocks, object lock or appliance retention invisible to this contract.
  const settings = config?.repository
  const immutableDays = settings?.makeRecentBackupsImmutableDays ?? (settings?.enableGovernanceMode ? settings.governanceModeRetentionDays : 0)
  const expiryKnown = !!config && ['LinuxLocal','LinuxHardened'].includes(config.type || '') && settings != null && Number.isFinite(immutableDays) && (config.type !== 'LinuxHardened' || (immutableDays ?? 0) > 0) && (config.type !== 'LinuxLocal' || settings.enableGovernanceMode === false || settings.enableGovernanceMode === true)
  const holdAll = !expiryKnown || policy.storage?.gfsPolicy?.isEnabled !== false
  if (!expiryKnown) notes.push('Repository deletion eligibility is not fully reported; no expiry credit is applied.')
  if (policy.storage?.gfsPolicy?.isEnabled !== false) notes.push('GFS is enabled or unknown; chains are held through the horizon instead of inventing archive expiry dates.')
  if (settings?.useFastCloningOnXFSVolumes) notes.push('Fast Clone is configured. File footprint does not equal separately allocated disk blocks.')
  const grouped = new Map<string, ForecastFile[]>()
  for (const file of files) {
    if (!file.objectIds?.length) return unavailable('File-to-workload membership is missing')
    if (!file.name || !/\.(vbk|vib)$/i.test(file.name)) return unavailable('Only full .vbk and forward incremental .vib files are modeled')
    const at = validTime(file.creationTime)
    if (at === null || at > now) return unavailable('File dates are missing, invalid or in the future')
    const key = [...new Set(file.objectIds)].sort().join(',')
    grouped.set(key, [...grouped.get(key) || [], file])
  }
  const values = Array.from({length: horizon + 1}, (_,i) => ({at: i === 0 ? now : dayStart(now) + i * DAY, bytes: 0, peak: 0, fulls: 0}))
  let incremental = 0
  for (const group of grouped.values()) {
    const sorted = [...group].sort((x,y) => validTime(x.creationTime)! - validTime(y.creationTime)!)
    let chains: Chain[] = []
    for (const file of sorted) {
      if (/\.vbk$/i.test(file.name!)) chains.push({points: [], hold: holdAll || !!file.gfsPeriods?.some(p=>p!=='None')})
      if (!chains.length) return unavailable('An incremental file has no retained full baseline')
      chains.at(-1)!.points.push({at: validTime(file.creationTime)!, bytes: file.backupSize!, hold: !!file.gfsPeriods?.some(p=>p!=='None')})
    }
    const increments = sorted.filter(f => /\.vib$/i.test(f.name!)).slice(-14)
    if (increments.length < 2) return unavailable('At least two retained increments per workload chain are required')
    if (now - validTime(sorted.at(-1)!.creationTime)! > 14 * DAY) return unavailable('File evidence is older than 14 days')
    const increment = median(increments.map(f => f.backupSize!))! * (1 + changePercent / 100)
    incremental += increment
    const fullSize = chains.at(-1)!.points[0].bytes
    const total = () => chains.reduce((sum,c) => sum + c.points.reduce((n,p) => n+p.bytes,0),0)
    values[0].bytes += total(); values[0].peak += total()
    for (let i = 1; i <= horizon; i++) {
      const at = values[i].at, weekday = weekdays[new Date(at).getUTCDay()], before = total()
      let peak = before
      if (runDays.includes(weekday) || fullDays.includes(weekday)) {
        const isFull = fullDays.includes(weekday)
        if (isFull) { chains.push({points: [], hold: holdAll}); values[i].fulls++ }
        chains.at(-1)!.points.push({at, bytes: isFull ? fullSize : increment, hold: false})
        peak = total()
        const all = chains.flatMap(c => c.points)
        const cutoff = retention?.type === 'Days' ? at - quantity * DAY : all[Math.max(0,all.length - quantity)].at
        const immutableCutoff = at - (immutableDays || 0) * DAY
        if (fullDays.length) {
          // Keep the newest chain and any older chain with a needed or held point.
          chains = chains.filter((chain,index) => index === chains.length - 1 || chain.hold || chain.points.some(p => p.hold || p.at >= cutoff || p.at >= immutableCutoff))
        } else if (!holdAll) {
          const chain = chains.at(-1)!
          while (chain.points.length > 1 && !chain.hold && !chain.points[0].hold && chain.points[0].at < cutoff && chain.points[1].at <= cutoff && chain.points[1].at < immutableCutoff) {
            // A merge retains the full baseline; block churn inside that full is unknown.
            chain.points[0].at = chain.points[1].at
            chain.points.splice(1,1)
          }
        }
      }
      values[i].bytes += total(); values[i].peak += peak
    }
  }
  notes.push('One successful run per scheduled day; UTC day buckets, fixed full size and recent median increment size. Retries, new workloads and intra-day timing are excluded.')
  notes.push('The daily peak sums per-chain sizes before expiry. Different job start times may reduce the simultaneous footprint.')
  return {values, notes: [...new Set(notes)], incremental, current}
}

/** Model independent workload chains separately; unmatched or insufficient chains stay visible but never get invented future bytes. */
export function projectBackup(backup: BackupPlan, policy: Policy | undefined, config: RepositoryConfig | undefined, now: number, horizon: number, changePercent = 0, retentionOverride?: number): Projection {
  const unique=uniqueFiles(backup.files)
  if(!backup.complete || unique.conflicts || !unique.files.length) return projectChainBackup(backup,policy,config,now,horizon,changePercent,retentionOverride)
  // Changing membership can describe the same physical workload in different file
  // groups. Do not run two independent future schedules for an overlapping member.
  const owners=new Map<string,string>(),ambiguous=new Set<string>()
  for(const file of unique.files) { const key=[...new Set(file.objectIds||[])].sort().join(',');for(const id of file.objectIds||[]) {const old=owners.get(id);if(old&&old!==key){ambiguous.add(old);ambiguous.add(key)}else owners.set(id,key)} }
  const groups=new Map<string,ForecastFile[]>()
  for(const file of unique.files) { const key=[...new Set(file.objectIds || [])].sort().join(',');groups.set(key,[...groups.get(key)||[],file]) }
  const results=[...groups.entries()].map(([key,files])=>({files,result:ambiguous.has(key)?{values:[],notes:[],current:null,incremental:null,reason:'Overlapping workload membership prevents independent chain sizing'} as Projection:projectChainBackup({...backup,files},policy,config,now,horizon,changePercent,retentionOverride)}))
  const included=results.filter(r=>r.result.values.length),excluded=results.filter(r=>!r.result.values.length)
  const known=unique.files.filter(f=>size(f.backupSize)),current=known.length?known.reduce((sum,f)=>sum+f.backupSize!,0):null
  if(!included.length) return {...results[0].result,current,modeledFileIds:[],excludedFiles:unique.files.length}
  const values=included[0].result.values.map((point,i)=>({...point,bytes:included.reduce((sum,r)=>sum+r.result.values[i].bytes,0),peak:included.reduce((sum,r)=>sum+r.result.values[i].peak,0),fulls:included.reduce((sum,r)=>sum+r.result.values[i].fulls,0)}))
  const excludedFiles=excluded.reduce((sum,r)=>sum+r.files.length,0)
  return {values,current,incremental:included.reduce((sum,r)=>sum+(r.result.incremental||0),0),modeledFileIds:included.flatMap(r=>r.files.map(f=>f.id)),excludedFiles,
    notes:[...new Set([...included.flatMap(r=>r.result.notes),...excluded.map(r=>`${r.files.length} files excluded from the scenario: ${r.result.reason}.`)])]}
}

export function repositoryBackups(snapshot: ForecastSnapshot, id: string) {
  const parent = snapshot.scaleOut.data.find(s => s.id === id)
  const ids = new Set([id, ...(parent?.performanceTier?.performanceExtents || []).map(e => e.id), ...(parent?.capacityTier?.extents || []).map(e => e.id), ...(parent?.archiveTier?.extentId ? [parent.archiveTier.extentId] : [])])
  return snapshot.backups.data.filter(b => ids.has(b.repositoryId || ''))
}
export function capacityTrend(observations: Observation[], id: string, now: number, horizon: number) {
  const raw = observations.filter(o => o.id === id && Date.parse(o.at) <= now && Date.parse(o.at) >= now - 30*DAY).sort((a,b) => Date.parse(a.at)-Date.parse(b.at))
  const last = raw.at(-1)
  // A capacity resize starts a new baseline instead of creating a false growth slope.
  let start = raw.length - 1
  while (start > 0 && raw[start-1].capacityGB === last?.capacityGB) start--
  const history = raw.slice(Math.max(0,start))
  const daily = new Map<number,Observation>(); history.forEach(o => daily.set(dayStart(Date.parse(o.at)),o))
  const samples = [...daily.values()], slopes: number[] = []
  for (let i=1;i<samples.length;i++) slopes.push(((samples[i].capacityGB-samples[i].freeGB)-(samples[i-1].capacityGB-samples[i-1].freeGB))/((Date.parse(samples[i].at)-Date.parse(samples[i-1].at))/DAY))
  const ready = samples.length >= 3 && Date.parse(samples.at(-1)!.at)-Date.parse(samples[0].at) >= 2*DAY && now-Date.parse(samples.at(-1)!.at) <= DAY
  const slope = ready ? median(slopes)! : null
  const used = last ? last.capacityGB-last.freeGB : null
  return { history, slope, values: slope !== null && used !== null ? Array.from({length:horizon+1},(_,i)=>({at: now+i*DAY,bytes: Math.max(0,used+slope*i)*GB})) : [],
    daysTo80: slope !== null && used !== null && last ? used >= last.capacityGB*.8 ? 0 : slope > 0 ? Math.ceil((last.capacityGB*.8-used)/slope) : null : null }
}
