// Open Backup UI v1.2.0
import { z } from 'zod'
import { validId, type Session } from '../investigation/model'
import type { Mount } from './model'

export type VmPowerState = 'PoweredOn' | 'PoweredOff' | 'Suspended'
export type InstantVmEvidence = {
  platform: 'VMware' | 'HyperV'
  manager?: string
  host?: string
  cluster?: string
  sourceVm?: string
  backupName?: string
  repository?: string
  writeCache?: string
  restorePointId?: string
  powerState?: VmPowerState
  targetName?: string
}

const text = z.string().min(1).nullish()
const target = z.object({ type: text, name: text, hostName: text }).nullish()
const spec = z.object({
  restorePointId: text, destinationHost: target,
  destination: z.object({ destinationHost: target, restoredVmName: text }).nullish(),
  target: z.object({ vmName: text }).nullish(),
  datastore: z.object({redirectEnabled:z.boolean().nullish(), cacheDatastore:target}).nullish(),
})

export function instantVmEvidence(kind: 'vSphere'|'hyperV', raw: unknown, reportedHost?: string | null): InstantVmEvidence {
  const platform = kind === 'vSphere' ? 'VMware' : 'HyperV'
  const parsed = spec.safeParse(raw)
  if (!parsed.success) return {platform, host:reportedHost || undefined}
  const value = parsed.data
  const placement = kind === 'vSphere' ? value.destination?.destinationHost : value.destinationHost
  const cluster = placement?.type === 'Cluster' ? placement.name || undefined : undefined
  const reported = reportedHost && reportedHost.toLowerCase() !== cluster?.toLowerCase() ? reportedHost : undefined
  return {platform, manager:placement?.hostName || undefined, cluster,
    host: reported || (placement?.type === 'Host' ? placement.name || undefined : undefined),
    targetName: (kind === 'vSphere' ? value.destination?.restoredVmName : value.target?.vmName) || undefined,
    restorePointId:validId(value.restorePointId) ? value.restorePointId.toLowerCase() : undefined,
    writeCache: kind === 'vSphere' && value.datastore?.redirectEnabled && value.datastore.cacheDatastore?.type === 'Datastore'
      ? value.datastore.cacheDatastore.name || undefined : undefined,
  }
}

export type MigrationTransfer = { phase:'idle'|'pending'|'migrating'|'succeeded'|'warning'|'failed'|'canceled'|'unknown'; progress?: number; transferredBytes?:number }

export function migrationTransfer(mount?: Pick<Mount,'state'> | null, session?: Session | null, child?: Session | null): MigrationTransfer {
  // child must be the returned migration-session ID or an explicitly verified related session.
  const operation = child?.sessionType === 'QuickMigration' ? child : session?.sessionType === 'QuickMigration' ? session : undefined
  if (!operation) return {phase: mount?.state === 'Migrating' ? 'migrating' : 'idle'}
  if (child === operation && session && session.id !== child.id && validId(child.parentSessionId) && child.parentSessionId !== session.id) return {phase:'unknown'}
  const percent = operation.progressPercent ?? operation.progress?.progressPercent
  const progress = typeof percent === 'number' && Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : undefined
  const bytes = operation.progress?.transferredSize
  const measures = {progress, ...(typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes >= 0 ? {transferredBytes:bytes} : {})}
  const state = operation.state
  if (state === 'Stopped' || operation.endTime) {
    const result = operation.result
    if (result?.isCanceled || ['Canceled','Cancelled'].includes(result?.result || '')) return {phase:'canceled', ...measures}
    if (result?.result === 'Failed') return {phase:'failed', ...measures}
    if (result?.result === 'Success') return {phase:'succeeded', ...measures}
    if (result?.result === 'Warning') return {phase:'warning', ...measures}
    return {phase:'unknown', ...measures}
  }
  if (state === 'Working') return {phase:'migrating', ...measures}
  if (state && ['Starting','Pending','WaitingTape','WaitingRepository','WaitingSlot','Pausing','Resuming','Stopping','Postprocessing','Idle','ActionRequired'].includes(state)) {
    return {phase:'pending', ...measures}
  }
  return {phase:'unknown', ...measures}
}
