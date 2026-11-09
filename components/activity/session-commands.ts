// Open Backup UI v1.0.2
import type { Mount } from '@/lib/activity/model'
import type { ActivityDetail } from '@/lib/activity/session'

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
    !data.session?.endTime && !['Stopping', 'Stopped'].includes(data.session?.state || '') &&
    data.mounts.some(live => live.kind === mount.kind && live.id === mount.id &&
      live.sessionId === data.id && ['Mounted', 'Failed', 'MountFailed', 'UnmountFailed'].includes(live.state))
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
