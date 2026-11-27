// Open Backup UI v1.3.0
import { record, type JsonRecord } from './model'

export type RestoreItemResult = {
  origin: 'statistics' | 'event'
  id?: string
  eventId?: string
  name: string
  result: string
  source?: string
  target?: string
  path?: string
  error?: string
  warnings: string[]
}

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined

export function restoreResultCounts(statistics: unknown) {
  const stats = record(statistics)
  return {
    total: count(stats.totalItemsCount),
    restored: count(stats.restoredItemsCount),
    failed: count(stats.failedItemsCount),
    skipped: count(stats.skippedItemsCount),
  }
}

export function restoreItemResults(statistics: unknown, events: readonly JsonRecord[]): RestoreItemResult[] {
  const stats = record(statistics)
  const rows: RestoreItemResult[] = []
  const pending = Array.isArray(stats.items) ? [...stats.items].reverse() : []
  while (pending.length) {
    const item = record(pending.pop())
    const name = text(item.name) || text(item.title)
    if (name) rows.push({
      origin: 'statistics', id: text(item.id), name, result: text(item.status) || 'Unknown',
      path: text(item.path), error: text(item.error) || text(item.cannotContinueMailboxError),
      warnings: Array.isArray(item.warnings) ? item.warnings.flatMap(warning => text(warning) || []) : [],
    })
    if (Array.isArray(item.childItems)) {
      for (let i = item.childItems.length - 1; i >= 0; i--) pending.push(item.childItems[i])
    }
  }
  // A session event ID identifies the event, while a statistics ID identifies the item.
  // Keep evidence separate when Veeam supplies duplicate names or no shared path.
  for (const event of events) {
    const name = text(event.itemName), status = text(event.status)
    if (event.type !== 'Restore' || !name || !status || !['Success','Failed','Warning','Skipped','Cancelled'].includes(status)) continue
    const message = text(event.message)
    rows.push({
      origin: 'event', eventId: text(event.id), name, result: status, source: text(event.source), target: text(event.target),
      error: status === 'Failed' ? message : undefined, warnings: status === 'Warning' && message ? [message] : [],
    })
  }
  return combineRestoreResults(rows, count(stats.totalItemsCount))
}

// Veeam may return a folder path in one feed and the full item path in the
// other. Match the entire location, retaining case and the original text.
function matchingPaths(path: string, name: string) {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '')
  return [normalized, ...(!/[\\/]/.test(name) ? [normalized + '/' + name] : [])]
}

export function combineRestoreResults(items: RestoreItemResult[], totalItems?: number): RestoreItemResult[] {
  const statistics = items.filter(row => row.origin === 'statistics')
  const events = items.filter(row => row.origin === 'event')
  if (!statistics.length || !events.length) return items
  const pathKey = (row: RestoreItemResult, path: string) => JSON.stringify([row.name, row.result, path])
  const candidates = new Map<string, RestoreItemResult | null>()
  for (const row of statistics) {
    if (!row.path) continue
    for (const path of matchingPaths(row.path, row.name)) {
      const key = pathKey(row, path)
      candidates.set(key, candidates.has(key) ? null : row)
    }
  }
  const matches = new Map<RestoreItemResult, RestoreItemResult | null>()
  for (const event of events) {
    const paths = [event.source, event.target].filter((path): path is string => !!path)
    const keys = paths.flatMap(path => matchingPaths(path, event.name))
    const matching = new Set(keys.map(path => candidates.get(pathKey(event, path))).filter(row => row !== undefined))
    // A confirmed one-item session can report the item's mailbox name in one
    // feed and its address in the other, with no comparable path.
    if (totalItems === 1 && statistics.length === 1 && events.length === 1 &&
        statistics[0].name === event.name && statistics[0].result === event.result) {
      matching.add(statistics[0])
    }
    for (const row of matching) {
      if (!row) continue
      // A competing event counts even when it also matches a different item.
      // A saved audit row may already have a confirmed event from an earlier read.
      const linkedElsewhere = row.eventId !== undefined && row.eventId !== event.eventId
      matches.set(row, matching.size === 1 && !matches.has(row) && !linkedElsewhere ? event : null)
    }
  }
  const used = new Set<RestoreItemResult>()
  const combined = statistics.map(row => {
    const event = matches.get(row)
    if (!event) return row
    used.add(event)
    return { ...row, source: event.source ?? row.source, target: event.target ?? row.target,
      eventId: event.eventId ?? row.eventId, error: row.error ?? event.error,
      warnings: [...new Set([...row.warnings, ...event.warnings])] }
  })
  return [...combined, ...events.filter(event => !used.has(event))]
}
