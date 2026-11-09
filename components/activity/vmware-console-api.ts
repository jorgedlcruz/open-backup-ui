import { veeamApi } from '@/lib/api/veeam-client'

export type ConsoleTarget = { sessionId: string; sourceKey: string; mountId: string }
export type VmwareDestination = {
  name: string
  managerType: 'esxi' | 'vcenter'
  powerState: 'on' | 'off' | 'suspended' | 'unknown'
  managementUrl: string | null
  consoleConfigured: boolean
  consolePermitted: boolean
}
export const consoleSetupPath = '/administration/data-sources#vmware-console-connections'
const endpoint = (target: ConsoleTarget) => '/api/vbr/activity/' + encodeURIComponent(target.sessionId) + '/vmware-console'
const scope = ({sourceKey, mountId}: ConsoleTarget) => ({sourceKey, mountId})

export function consolePage(target: ConsoleTarget) {
  return '/vbr/activity/' + encodeURIComponent(target.sessionId) + '/console?' + new URLSearchParams(scope(target))
}

export function readVmwareDestination(target: ConsoleTarget, signal: AbortSignal) {
  return veeamApi.requestActivity<{destination: VmwareDestination | null}>(endpoint(target) + '?' + new URLSearchParams(scope(target)), {signal})
}

export function issueConsoleTicket(target: ConsoleTarget, signal: AbortSignal) {
  return veeamApi.requestActivity<{url: string; name: string}>(endpoint(target), {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(scope(target)), signal,
  })
}

export function managementLink(destination?: VmwareDestination | null) {
  if (!destination?.managementUrl) return null
  try {
    const url = new URL(destination.managementUrl)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch { return null }
}
