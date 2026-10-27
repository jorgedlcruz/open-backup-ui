import { z } from 'zod'
import { TopologyRequestError } from '../topology/load'
import { jobSchema, sessionSchema, repositorySchema, securitySchema, type Collection, type OperationsSnapshot, type Range } from './model'

type Read = (path: string) => Promise<unknown>

// Preserve existing filters on every page, deduplicate IDs and report bounded/partial reads.
export async function readOperationsCollection<T extends { id: string }>(read: Read, path: string, schema: z.ZodType<T>, max = 5000, identity: (item: T) => string = item => item.id): Promise<Collection<T>> {
  const items = new Map<string, T>()
  let skip = 0
  const limit = 200
  for (let page = 0; page < 100; page++) {
    const url = new URL(path, 'https://vbr.invalid')
    url.searchParams.set('skip', String(skip))
    url.searchParams.set('limit', String(Math.min(limit, max - items.size)))
    const response = z.object({ data: z.array(schema), pagination: z.object({ total: z.number().optional() }).optional() })
      .parse(await read(url.pathname + url.search))
    const before = items.size
    for (const item of response.data) if (items.size < max) items.set(identity(item), item)
    skip += response.data.length
    const total = response.pagination?.total
    const result = (complete: boolean) => ({ data: [...items.values()], available: true, complete })
    if (response.data.length && items.size === before) return result(false)
    if (total !== undefined && skip >= total) return result(items.size >= total)
    if (!response.data.length) return result(total === undefined || skip >= total)
    if (total === undefined && response.data.length < limit) return result(items.size >= skip)
    if (items.size >= max) return result(false)
  }
  return { data: [...items.values()], available: true, complete: false }
}

export async function loadOperations(read: Read, sourceName: string, range: Range, now = new Date()): Promise<OperationsSnapshot> {
  const warnings: string[] = []
  const from = new Date(now.getTime() - (range === '24h' ? 1 : range === '7d' ? 7 : 30) * 86400000).toISOString()
  async function section<T>(label: string, work: Promise<Collection<T>>): Promise<Collection<T>> {
    try {
      const result = await work
      if (!result.complete) warnings.push(`${label}: partial collection. Counts describe loaded records only.`)
      return result
    } catch (error) {
      if (error instanceof TopologyRequestError && error.status === 401) throw error
      const reason = error instanceof z.ZodError ? 'The response did not match the expected API fields.'
        : error instanceof TopologyRequestError ? error.message : 'Check the source connection and retry.'
      warnings.push(`${label} unavailable. ${reason}`)
      return { data: [], available: false, complete: false }
    }
  }
  const [jobs, sessions, repositories, security] = await Promise.all([
    section('Jobs', readOperationsCollection(read, '/api/v1/jobs/states', jobSchema)),
    section('Session history', readOperationsCollection(read, `/api/v1/sessions?orderColumn=CreationTime&orderAsc=false&createdAfterFilter=${encodeURIComponent(from)}`, sessionSchema, 4000)),
    section('Repositories', readOperationsCollection(read, '/api/v1/backupInfrastructure/repositories/states', repositorySchema)),
    section('Security checks', read('/api/v1/securityAnalyzer/bestPractices').then(value => ({
      data: z.object({ items: z.array(securitySchema) }).parse(value).items, available: true, complete: true,
    }))),
  ])
  if (![jobs, sessions, repositories, security].some(section => section.available)) {
    throw new TopologyRequestError('VBR returned no usable operations data. Check the connection and permissions, then retry.', 502)
  }
  return { sourceName, fetchedAt: now.toISOString(), from, range, jobs, sessions, repositories, security, warnings }
}
