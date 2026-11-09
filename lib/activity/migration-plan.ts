// Open Backup UI v1.0.2
import type { LogRecord } from '../investigation/model'

export type MigrationPlan = {sourceHost?: string; targetHost?: string; sources: string[]; targets: string[]}

// VBR writes one multi-line migration plan to the individual VM's task log.
export function readMigrationPlan(logs: LogRecord[]): MigrationPlan | undefined {
  const plans = logs.filter(entry => /^Migration plan:[ \t]*\r?\n/i.test(entry.title || ''))
    .sort((a,b) => (b.updateTime || b.startTime || '').localeCompare(a.updateTime || a.startTime || '') || (b.id ?? 0) - (a.id ?? 0))
  const lines = plans[0]?.title?.split(/\r?\n/)
  if (!lines) return
  const sources = new Set<string>(), targets = new Set<string>()
  const hosts = new Set<string>(), destinations = new Set<string>()
  for (const line of lines) {
    const pair = /^\s*\[(Host|Datastore)\]\s+(.+?)\s+>\s+(.+?)\s*$/i.exec(line)
    if (!pair) continue
    const [, type, from, to] = pair
    if (type.toLowerCase() === 'host') {
      hosts.add(from); destinations.add(to)
    } else {
      sources.add(from.replace(/^\[(.*)\]$/, '$1'))
      targets.add(to.replace(/^\[(.*)\]$/, '$1'))
    }
  }
  if (!hosts.size && !sources.size) return
  return {sourceHost:hosts.size === 1 ? [...hosts][0] : undefined, targetHost:destinations.size === 1 ? [...destinations][0] : undefined,
    sources:[...sources], targets:[...targets]}
}
