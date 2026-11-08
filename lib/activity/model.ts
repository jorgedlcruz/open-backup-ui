import { z } from 'zod'
import { investigationSessionSchema, recordStatus, time, uuid, type Session } from '../investigation/model'

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
}

export function parseMount(kind: MountKind, raw: unknown): Mount {
  if (kind === 'publish') {
    const item = z.object({id, mountState: z.string(), backupName: z.string().nullish(), restorePointName: z.string().nullish(),
      info: z.object({serverIps: z.array(z.string()).nullish()}).nullish(),
    }).parse(raw)
    // Published disk records expose a mount ID only. A session log can be opened when history supplies the same ID.
    return {id: item.id, sessionId: item.id, kind, state: item.mountState, name: item.restorePointName ?? undefined,
      host: item.info?.serverIps?.join(', '), backup: item.backupName ?? undefined}
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

export function mergeActivity(sessions: Session[], mounts: Mount[]): ActivityRow[] {
  const bySession = new Map(sessions.map(session => [session.id, session]))
  const mountedSessions = new Set(mounts.map(mount => mount.sessionId))
  const rows: ActivityRow[] = mounts.map(mount => {
    const session = bySession.get(mount.sessionId)
    return {key: `${mount.kind}/${mount.id}`, sessionId: mount.sessionId, name: mount.name || session?.name || mount.id,
      state: mount.state, mount, session}
  })
  for (const session of bySession.values()) {
    if (!mountedSessions.has(session.id)) rows.push({key: session.id, sessionId: session.id, name: session.name || session.id, state: recordStatus(session), session})
  }
  return rows.sort((a,b) => Number(!!b.mount) - Number(!!a.mount) ||
    (time(b.session?.creationTime) ?? 0) - (time(a.session?.creationTime) ?? 0) || a.name.localeCompare(b.name))
}

export { investigationSessionSchema }
export const historySize = 50
export type ActivityQuery = {skip: number; name: string; focus?: string; state: string}
export type ActivityFeed = {
  rows: ActivityRow[]; total: number | null; hasMore: boolean; warnings: string[]; sourceKey: string; sourceName: string
}
