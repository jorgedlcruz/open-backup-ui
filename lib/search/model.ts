export type SearchPlatform = 'vbr' | 'vb365'
export type SearchKind = 'VBR Workload' | 'VBR Job' | 'VB365 Job' | 'VB365 Item' | 'VBR Repository' | 'VB365 Repository'
export const searchScopes = ['all', 'workloads', 'jobs', 'repositories'] as const
export type SearchScope = typeof searchScopes[number]
export type SearchSignal = { label: string; tone: 'success' | 'warning' | 'danger' | 'active' | 'neutral' }
export type SearchFact = { label: string; value: string; kind?: 'date' }
export type SearchResult = {
  key: string; id: string; name: string; type: SearchKind; url: string; description: string;
  signal?: SearchSignal; facts?: SearchFact[]; note?: string; lazy?: boolean; approximate?: boolean;
}
export type SearchItem = SearchResult & { terms: string; detail?: { objectType: 'User' | 'Group' | 'Site' | 'Team'; organizationId?: string | null } }
export type SearchIndex = { items: SearchItem[]; warnings: string[]; complete: boolean; fetchedAt: string }
export type SearchResponse = { results: SearchResult[]; total: number; warnings: string[]; fetchedAt: string }
export type PreviewResponse = { result: SearchResult; warnings: string[]; complete: boolean; fetchedAt: string }
export const platformLabels: Record<SearchPlatform, string> = { vbr: 'VBR', vb365: 'Microsoft 365' }
export const resultPlatform = (result: Pick<SearchResult, 'type'>): SearchPlatform => result.type.startsWith('VBR ') ? 'vbr' : 'vb365'
export const resultScope = (result: Pick<SearchResult, 'type'>): SearchScope => result.type.endsWith('Job') ? 'jobs' : result.type.endsWith('Repository') ? 'repositories' : 'workloads'
export const actionLabel = (result: Pick<SearchResult, 'type'>) => resultScope(result) === 'jobs' ? 'Inspect job & sessions' : resultScope(result) === 'repositories' ? 'Inspect repository' : 'Inspect recovery points'
export function publicResult({ key, id, name, type, url, description, signal, facts, note, lazy }: SearchItem): SearchResult {
  return { key, id, name, type, url, description, signal, facts, note, lazy }
}

export function searchable(values: unknown[]): string {
  return values.filter(value => typeof value === 'string').join(' ').normalize('NFKC').toLocaleLowerCase()
}

// One typo (including a transposition), only in meaningful name tokens. Exact
// matches always win; short terms and metadata never produce fuzzy suggestions.
function nearWord(a: string, b: string) {
  if (a === b) return true
  if (a.length < 4 || a.length > 40 || Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++
  return a.length === b.length
    ? a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
    : a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

export function searchIndex(index: SearchIndex, query: string, limit = 20, scope: SearchScope = 'all'): SearchResponse {
  const text = searchable([query.trim()]), words = text.split(/\s+/).filter(Boolean)
  const candidates = index.items.filter(item => scope === 'all' || resultScope(item) === scope)
  let matches = text.length < 2 ? [] : candidates.filter(item => words.every(word => item.terms.includes(word)))
  let approximate = false
  if (!matches.length && words.some(word => word.length >= 4) && words.length <= 8) {
    matches = candidates.filter(item => {
      const name = searchable([item.name]), tokens = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
      return words.every(word => name.includes(word) || tokens.some(token => nearWord(word, token)))
    })
    approximate = !!matches.length
  }
  const rank = (item: SearchItem) => {
    const name = searchable([item.name])
    return name === text ? 0 : name.startsWith(text) ? 1 : name.includes(text) ? 2 : 3
  }
  matches.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
  return { results: matches.slice(0, limit).map(item => ({ ...publicResult(item), ...(approximate ? { approximate: true } : {}) })), total: matches.length, warnings: index.warnings, fetchedAt: index.fetchedAt }
}
