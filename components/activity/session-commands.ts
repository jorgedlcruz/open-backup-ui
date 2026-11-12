// Open Backup UI v1.2.0
import type { Mount } from '@/lib/activity/model'
import type { ActivityDetail } from '@/lib/activity/session'
import type { MigrationReceipt } from '@/lib/activity/migration-receipt'
import type { MigrationTransfer } from '@/lib/activity/instant-vm'

export function migrationDestination(mountId: string, childId: string | undefined,
  association: NonNullable<ActivityDetail['instantMigrations']>[number] | undefined, receipt: MigrationReceipt | undefined) {
  const verified = association?.mountId === mountId && association.session.id === childId ? association.destination : undefined
  const local = receipt?.mount.id === mountId && (!childId || childId !== receipt.previousChildId &&
    (!receipt.childId || receipt.childId === childId)) ? receipt.destination : undefined
  const host = verified?.host || local?.host, datastore = verified?.datastore || local?.datastore
  return host || datastore ? {host, datastore} : undefined
}

export function isInstantVmMount(mount: Mount) {
  return mount.kind === 'vSphere' || mount.kind === 'hyperV'
}

export function mountKey(mount: Mount) {
  return mount.kind + '/' + mount.id
}

export function migrationForMount(mount: Mount, mounts: Mount[], child: ActivityDetail['instantMigration'], scoped: ActivityDetail['instantMigrations'] = []) {
  const receipt = scoped.find(row => row.mountId === mount.id)
  if (receipt) return receipt.session
  if (!child || scoped.some(row => row.session.id === child.id)) return undefined
  if (child.resourceId) return child.resourceId === mount.id ? child : undefined
  return mounts.length === 1 ? child : undefined
}

export function canStopPublishing(mount: Mount, data: ActivityDetail, readError: string) {
  return isInstantVmMount(mount) && !readError && !data.mountWarnings.includes(mount.kind) &&
    data.session?.state !== 'Stopping' &&
    data.mounts.some(live => live.kind === mount.kind && live.id === mount.id &&
      live.sessionId === data.id && ['Mounted', 'Failed', 'MountFailed', 'UnmountFailed'].includes(live.state))
}

// A finished migration must not be submitted again, but its source publication
// can remain mounted and still needs cleanup. Keep these two locks separate.
export function instantRecoveryLocks(mount: Mount, phase: MigrationTransfer['phase'], hasReceipt: boolean, pendingLock = false) {
  const retryable = ['failed', 'canceled'].includes(phase) && mount.state === 'Mounted'
  return {
    migration: !retryable && (hasReceipt || phase !== 'idle'),
    // Verified terminal evidence also releases a callback left by an unmounted map tab.
    publication: mount.state === 'Migrating' || ['pending', 'migrating', 'unknown'].includes(phase) || phase === 'idle' && (hasReceipt || pendingLock),
  }
}

export function currentMigrationSession(session: ActivityDetail['instantMigration'], receipt: MigrationReceipt | undefined, verifiedAssociation = false) {
  return session && session.id !== receipt?.previousChildId &&
    (verifiedAssociation || !receipt?.childId || session.id === receipt.childId) ? session : undefined
}

export function browsableGuestMount(data:ActivityDetail|undefined,readError:string,unmounted:boolean) {
  if(!data||readError||unmounted||data.mountWarnings.includes('flr')||data.session?.endTime||
    ['Stopping','Stopped'].includes(data.session?.state||''))return undefined
  return data.mounts.find(m=>m.kind==='flr'&&m.sessionId===data.id&&m.state==='Mounted')
}

// A migration can outlive the mount that started it. Only use a saved mount as display context.
export function recoveryMapMounts(data: ActivityDetail, remembered: Mount[], query: string) {
  const params = new URLSearchParams(query)
  const kind = params.get('kind'), id = params.get('mount')?.toLowerCase()
  const mounts = new Map<string, Mount>()
  const snapshots = remembered.map(mount => ({
    ...mount, state: 'Not reported', instantVm: mount.instantVm && {...mount.instantVm, powerState:undefined},
  }))
  for (const mount of [...snapshots, ...data.mounts]) {
    if (isInstantVmMount(mount) && mount.sessionId === data.id && (!kind || kind === mount.kind) && (!id || id === mount.id)) {
      mounts.set(mountKey(mount), mount)
    }
  }
  return [...mounts.values()]
}
