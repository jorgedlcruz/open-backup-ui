import type { SearchKind, SearchResult } from './model'

export type RecentResult = Pick<SearchResult, 'key' | 'name' | 'type'>
const kinds: SearchKind[] = ['VBR Workload', 'VBR Job', 'VB365 Job', 'VB365 Item', 'VBR Repository', 'VB365 Repository']
export function readRecents(value: unknown): RecentResult[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap(row => {
    if (!row || typeof row.key !== 'string' || row.key.length > 8192 || typeof row.name !== 'string' || row.name.length > 2048 || !kinds.includes(row.type) || seen.has(row.key)) return []
    if (!row.key.startsWith(row.type.startsWith('VBR ') ? 'vbr:' : 'vb365:')) return []
    seen.add(row.key)
    // No destination URLs, health facts, or credentials are persisted. A recent
    // result must be resolved again against the current authenticated source.
    return [{ key: row.key, name: row.name, type: row.type as SearchKind }]
  }).slice(0, 6)
}
export function rememberResult(previous: RecentResult[], result: SearchResult): RecentResult[] {
  return readRecents([result, ...previous.filter(row => row.key !== result.key)])
}
export function recentResult(row: RecentResult): SearchResult {
  return { ...row, id: '', url: '', description: 'Previously opened · verifying current source', lazy: true, signal: { label: 'Recent destination', tone: 'neutral' } }
}
