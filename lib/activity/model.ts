import { z } from 'zod'
import { investigationSessionSchema, recordStatus, time, uuid, validId, type Session } from '../investigation/model'

const id = z.string().regex(uuid).transform(value => value.toLowerCase())
export const platforms = ['vSphere', 'hyperV', 'fcd', 'flr', 'publish'] as const
export type MountKind = typeof platforms[number]
export const mountPaths: Record<MountKind, string> = {
  vSphere: '/api/v1/restore/instantRecovery/vSphere/vm',
  hyperV: '/api/v1/restore/instantRecovery/hyperV/vm',
  fcd: '/api/v1/restore/instantRecovery/vSphere/fcd',
  flr: '/api/v1/backupBrowser/flr',
  publish: '/api/v1/dataIntegration',
}
export type Mount = {
  id: string; sessionId: string; kind: MountKind|'other'; operation?: string; state: string; name?: string
  host?: string; backup?: string; pointTime?: string; error?: string; disks?: string[]; originalLocation?: boolean
  publication?: {mode?: string; port?: number; disks: {name?: string; accessLink?: string; mountPoints: string[]}[]}
}

export function parseMount(kind: MountKind, raw: unknown): Mount {
  if (kind === 'publish') {
    const item = z.object({id, mountState: z.string(), backupName: z.string().nullish(), restorePointName: z.string().nullish(),
      info: z.object({mode: z.string().nullish(), serverPort: z.number().int().nullish(), serverIps: z.array(z.string()).nullish(),
        disks: z.array(z.object({diskName: z.string().nullish(), accessLink: z.string().nullish(), mountPoints: z.array(z.string()).nullish()})).nullish(),
      }).nullish(),
    }).parse(raw)
    const disks = item.info?.disks?.map(disk => ({name: disk.diskName ?? undefined, accessLink: disk.accessLink || undefined,
      mountPoints: disk.mountPoints ?? []})) ?? []
    // The disk inventory exposes only a mount ID. SessionModel carries the optional resource link.
    return {id: item.id, sessionId: item.id, kind, state: item.mountState, name: item.restorePointName ?? undefined,
      host: item.info?.serverIps?.join(', '), backup: item.backupName ?? undefined,
      disks: disks.flatMap(disk => disk.name ? [disk.name] : []),
      publication: item.info ? {mode: item.info.mode ?? undefined, port: item.info.serverPort ?? undefined, disks} : undefined}
  }
  if (kind === 'flr') {
    const item = z.object({
      sessionId: id, sourceProperties: z.object({machineName: z.string()}).nullish(),
      mountErrors: z.array(z.object({ message: z.string().optional() })).optional(),
    }).parse(raw)
    return { id: item.sessionId, sessionId: item.sessionId, kind, state: 'Mounted',
      name: item.sourceProperties?.machineName, error: item.mountErrors?.map(error => error.message).filter(Boolean).join(' · ') }
  }
  const item = z.object({
    id, sessionId: id, state: z.string(), vmName: z.string().nullish(), hostName: z.string().nullish(),
    jobName: z.string().nullish(), restorePointDate: z.string().nullish(), errorMessage: z.string().nullish(),
    spec: z.object({type: z.string().nullish()}).nullish(),
    mountedDisks: z.array(z.object({mountedDiskName: z.string()})).nullish(),
  }).parse(raw)
  const disks = item.mountedDisks?.map(disk => disk.mountedDiskName)
  return { id: item.id, sessionId: item.sessionId, state: item.state, kind, originalLocation: item.spec?.type === 'OriginalLocation',
    name: item.vmName || disks?.join(', '), host: item.hostName ?? undefined,
    backup: item.jobName ?? undefined, pointTime: item.restorePointDate ?? undefined, error: item.errorMessage ?? undefined, disks }
}

export type ActivityRow = { key: string; sessionId: string; name: string; state: string; session?: Session; mount?: Mount }

export function sessionProgress(session?: Session | null, mount?: Mount) {
  if (mount?.state === 'Mounted') return undefined
  const percent = session?.progressPercent ?? session?.progress?.progressPercent
  return percent != null && percent >= 0 && percent <= 100 ? percent : undefined
}

export function canUnmountGuestFiles(mount: Mount | undefined, session: Session | null | undefined) {
  return mount?.kind === 'flr' && mount.state === 'Mounted' && !session?.endTime && session?.state !== 'Stopped'
}

export function mountBelongsToSession(mount: Mount, session: Session) {
  if (mount.kind !== 'publish') return mount.sessionId === session.id
  if (session.sessionType !== 'PublishBackupContentViaMount') return false
  // Only a literal API resource path on this VBR source can identify the mount by URI.
  // Never fetch a resourceReference or infer an association from a restore point, name or time.
  const target = /^\/api\/v1\/dataIntegration\/([^/?#]+)\/?$/i.exec(session.resourceReference || '')?.[1].toLowerCase()
  if (target && (!validId(target) || target !== mount.id)) return false
  if (validId(session.resourceId) && session.resourceId !== session.id && session.resourceId !== mount.id) return false
  return mount.id === session.id || mount.id === session.resourceId || mount.id === target
}

export function mergeActivity(sessions: Session[], mounts: Mount[]): ActivityRow[] {
  const bySession = new Map(sessions.map(session => [session.id, session]))
  const mountedSessions = new Set<string>()
  const rows: ActivityRow[] = mounts.map(mount => {
    let session = bySession.get(mount.sessionId)
    if (mount.kind === 'publish') {
      const candidates = sessions.filter(item => mountBelongsToSession(mount, item))
      // A publish and an unpublish can refer to the same resource. Keep separate history rows
      // if neither the native ID nor a unique session establishes which log should be linked.
      session = candidates.find(item => item.id === mount.id) || (candidates.length === 1 ? candidates[0] : undefined)
    }
    if (session) mountedSessions.add(session.id)
    const sessionId = session?.id || mount.sessionId
    return {key: `${mount.kind}/${mount.id}`, sessionId, name: mount.name || session?.name || mount.id,
      state: mount.state, mount: {...mount, sessionId}, session}
  })
  for (const session of bySession.values()) {
    if (!mountedSessions.has(session.id)) rows.push({key: session.id, sessionId: session.id, name: session.name || session.id, state: recordStatus(session), session})
  }
  return rows.sort((a,b) => Number(!!b.mount) - Number(!!a.mount) ||
    (time(b.session?.creationTime) ?? 0) - (time(a.session?.creationTime) ?? 0) || a.name.localeCompare(b.name))
}

export { investigationSessionSchema }
export const historySize = 50
export type { ActivityQuery } from './filters'
export type ActivityFeed = {
  rows: ActivityRow[]; total: number | null; hasMore: boolean; nextSkip: number; before: string; warnings: string[]; sourceKey: string; sourceName: string
}
