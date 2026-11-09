// Open Backup UI v1.0.2
import { z } from 'zod'
import { validId, investigationSessionSchema, taskSchema, type Session } from '../investigation/model'
import type { VbrReader, VmPowerReader } from '../server/vbr-read'
import { TopologyRequestError } from '../topology/load'
import type { Mount } from './model'
import { readMigrationLinks, type MigrationLink } from '../server/migration-links'

async function optional<T>(fn: () => Promise<T>) {
  try { return await fn() }
  catch (error) {
    if (error instanceof TopologyRequestError && error.status === 401) throw error
    return undefined
  }
}

const pointSchema = z.object({ id:z.string(), name:z.string().min(1), backupId:z.string().nullish() })
const backupSchema = z.object({ id:z.string(), name:z.string().min(1), repositoryName:z.string().nullish() })
const inventoryPage = z.object({
  pagination:z.object({ total:z.literal(1), count:z.literal(1), skip:z.literal(0) }),
  data:z.array(z.object({
    type:z.literal('VirtualMachine'), platform:z.enum(['VSphere','HyperV']), hostName:z.string(), name:z.string(),
    objectId:z.string().min(1), urn:z.string().nullish(), aclInfo:z.object({isAllowed:z.literal(true)}),
    powerState:z.enum(['PoweredOn','PoweredOff','Suspended']),
  })).length(1),
})

export async function enrichInstantVm(read: VbrReader, mount: Mount, inventory?: VmPowerReader): Promise<Mount> {
  const info = mount.instantVm
  if (!info?.restorePointId || !['vSphere','hyperV'].includes(mount.kind)) return mount
  const point = await optional(async () => pointSchema.parse(await read('/api/v1/restorePoints/' + info.restorePointId, '1.3-rev2')))
  if (!point || point.id.toLowerCase() !== info.restorePointId) return mount
  const platform = mount.kind === 'vSphere' ? 'VSphere' : 'HyperV'
  const manager = info.manager
  const vmName = mount.name
  const [backup, power] = await Promise.all([
    validId(point.backupId) ? optional(async () => backupSchema.parse(await read('/api/v1/backups/' + point.backupId, '1.3-rev2'))) : undefined,
    // On original-location restores the VBR mount has no recovered VM MoRef. Never show the production VM's
    // runtime state by matching a shared display name, or treat spec.powerUp as a measurement.
    mount.state === 'Mounted' && inventory && manager && vmName && info.targetName === vmName && vmName.toLowerCase() !== point.name.toLowerCase()
      ? optional(async () => {
        const raw = await inventory(manager, platform, vmName)
        const parsed = inventoryPage.safeParse(raw)
        if (!parsed.success) return undefined
        const vm = parsed.data.data[0]
        if (vm.name !== vmName || vm.hostName.toLowerCase() !== manager.toLowerCase() || vm.platform !== platform) return undefined
        if (platform === 'VSphere') {
          const path = vm.urn?.toLowerCase().split(';')
          if (!path || !['vc:' + manager.toLowerCase(), 'esx:' + manager.toLowerCase()].includes(path[0])
            || path.at(-1) !== 'vm:' + vm.objectId.toLowerCase()) return undefined
        }
        return vm.powerState
      }) : undefined,
  ])
  const confirmed = backup && backup.id.toLowerCase() === point.backupId?.toLowerCase() ? backup : undefined
  return { ...mount, instantVm:{ ...info, sourceVm:point.name, backupName:confirmed?.name, repository:confirmed?.repositoryName || undefined, powerState:power } }
}

function mountReference(session: Session) {
  const match = /^\/api\/v1\/restore\/instantRecovery\/(?:vSphere|hyperV)\/vm\/([^/?#]+)\/?$/i.exec(session.resourceReference || '')
  return match?.[1].toLowerCase()
}

export async function relatedMigration(read: VbrReader, parent: Session | null, link?: MigrationLink): Promise<Session | null> {
  if (parent?.sessionType !== 'InstantRecovery') return null
  const related = link?.childSessionId ?? parent.relatedSessionId
  if (!validId(related) || related === parent.id) return null
  if (link && (link.parentSessionId !== parent.id || validId(parent.relatedSessionId) && parent.relatedSessionId !== related ||
    mountReference(parent) && mountReference(parent) !== link.mountId)) return null
  const child = await optional(async () => investigationSessionSchema.parse(await read('/api/v1/sessions/' + related, '1.3-rev2')))
  if (!child || child.id !== related || child.sessionType !== 'QuickMigration' || validId(child.parentSessionId) && child.parentSessionId !== parent.id) return null
  if (link && (validId(child.resourceId) && child.resourceId !== link.mountId || mountReference(child) && mountReference(child) !== link.mountId)) return null
  if (child.progress?.transferredSize == null && child.state === 'Working') {
    const tasks = await optional(async () => z.object({
      data:z.array(taskSchema).length(1), pagination:z.object({total:z.literal(1), skip:z.literal(0), count:z.literal(1)}),
    }).parse(await read('/api/v1/sessions/' + child.id + '/taskSessions?skip=0&limit=2', '1.3-rev2')))
    const task = tasks?.data[0]
    if (task?.sessionId === child.id && task.progress?.transferredSize != null && Number.isSafeInteger(task.progress.transferredSize) && task.progress.transferredSize >= 0) {
      return {...child,progress:{...child.progress,transferredSize:task.progress.transferredSize}}
    }
  }
  return child
}

export type ScopedMigration = {mountId: string; session: Session}
export async function sessionMigrations(read: VbrReader, sourceKey: string, parent: Session | null, hint?: Pick<Mount,'id'|'kind'>,
  receipts = readMigrationLinks) {
  const empty = {instantMigration:null, instantMigrations:[] as ScopedMigration[]}
  if (parent?.sessionType !== 'InstantRecovery' || (hint && !['vSphere','hyperV'].includes(hint.kind))) return empty
  const links = await optional(() => receipts(sourceKey, parent.id, hint?.id)) ?? []
  const scoped = links.filter(link => link.sourceKey === sourceKey && (!hint || link.mountId === hint.id))
  const children = await Promise.all(scoped.map(async link => {
    const session = await relatedMigration(read, parent, link)
    return session ? {mountId:link.mountId, session} : null
  }))
  const instantMigrations = children.filter((row): row is ScopedMigration => row !== null)
  // Only an unambiguous child can describe the entire view. Per-mount evidence stays keyed separately.
  const native = validId(parent.relatedSessionId) && !scoped.some(link => link.childSessionId === parent.relatedSessionId)
    ? await relatedMigration(read, parent) : null
  const nativeMount = native && (mountReference(native) || native.resourceId || mountReference(parent))
  const instantMigration = instantMigrations.length === 1 && scoped.length === 1 ? instantMigrations[0].session
    : native && (!hint || hint.id === nativeMount) ? native : null
  return {instantMigration, instantMigrations}
}
