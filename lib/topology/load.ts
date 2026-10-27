import { z } from 'zod'
import { buildTopology, type BackupMembership, type TopologySnapshot } from './model'

const objectSchema = z.object({ id: z.string().min(1), name: z.string(), platformName: z.string().optional(), restorePointsCount: z.number().nonnegative().optional() })
const backupSchema = z.object({ id: z.string().min(1), name: z.string(), jobId: z.string().optional(), repositoryId: z.string().optional(), repositoryName: z.string().optional() })
const optionalText = z.string().nullish().transform(value => value ?? undefined)
const optionalBool = z.boolean().nullish().transform(value => value ?? undefined)
const optionalNumber = z.number().finite().nullish().transform(value => value ?? undefined)
const jobSchema = z.object({ id: z.string().min(1), name: z.string(), type: optionalText, status: optionalText, lastResult: optionalText, isRunning: optionalBool, isDisabled: optionalBool })
// Some repository types report negative or absent capacity. Retain their identity
// and availability, and let the model classify unmeasured capacity as unknown.
const repositorySchema = z.object({ id: z.string().min(1), name: z.string(), type: optionalText, isOnline: optionalBool, capacityGB: optionalNumber, freeGB: optionalNumber })

export class TopologyRequestError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

type RequestJson = (path: string) => Promise<unknown>

// Bound requests and graph size. Truncation is always returned as a warning.
export async function readCollection<T extends { id: string }>(request: RequestJson, path: string, schema: z.ZodType<T>, maxItems = 10000): Promise<{ data: T[]; truncated: boolean }> {
  const items = new Map<string, T>()
  let skip = 0
  const limit = 200
  for (let page = 0; page < 100; page++) {
    const result = z.object({
      data: z.array(schema),
      pagination: z.object({ total: z.number().nonnegative().optional() }).optional(),
    }).parse(await request(`${path}?skip=${skip}&limit=${limit}`))
    const before = items.size
    for (const item of result.data) if (items.size < maxItems) items.set(item.id, item)
    skip += result.data.length
    const total = result.pagination?.total
    if (result.data.length && items.size === before) return { data: [...items.values()], truncated: true }
    if (total !== undefined && skip >= total) return { data: [...items.values()], truncated: skip > maxItems }
    if (!result.data.length) return { data: [...items.values()], truncated: total !== undefined && skip < total }
    if (total === undefined && result.data.length < limit) return { data: [...items.values()], truncated: skip > maxItems }
    if (items.size >= maxItems || items.size === before) return { data: [...items.values()], truncated: true }
  }
  return { data: [...items.values()], truncated: true }
}

export async function loadTopology(request: RequestJson, sourceName: string): Promise<TopologySnapshot> {
  const warnings: string[] = []
  const collection = async <T extends { id: string }>(path: string, schema: z.ZodType<T>, label: string, max?: number) => {
    const result = await readCollection(request, path, schema, max)
    if (result.truncated) warnings.push(`${label} reached the view limit; some records are not shown.`)
    return result.data
  }
  const optional = async <T,>(promise: Promise<T[]>, label: string): Promise<T[]> => {
    try { return await promise } catch (error) {
      if (error instanceof TopologyRequestError && error.status === 401) throw error
      warnings.push(`${label} could not be loaded. Their status is unknown.`)
      return []
    }
  }
  const [objects, backups, jobs, repositories] = await Promise.all([
    collection('/api/v1/backupObjects', objectSchema, 'Workloads'),
    collection('/api/v1/backups', backupSchema, 'Backups', 200),
    optional(collection('/api/v1/jobs/states', jobSchema, 'Jobs'), 'Job details'),
    optional(collection('/api/v1/backupInfrastructure/repositories/states', repositorySchema, 'Repositories'), 'Repository details'),
  ])
  const memberships: BackupMembership[] = []
  let cursor = 0
  let failed = 0
  // A small worker pool avoids issuing one simultaneous request per backup.
  await Promise.all(Array.from({ length: Math.min(4, backups.length) }, async () => {
    while (cursor < backups.length) {
      const backup = backups[cursor++]
      try {
        const data = await collection(`/api/v1/backups/${encodeURIComponent(backup.id)}/objects`, objectSchema, `Members of ${backup.name}`)
        memberships.push({ backupId: backup.id, objects: data })
      } catch (error) {
        if (error instanceof TopologyRequestError && error.status === 401) throw error
        failed++
      }
    }
  }))
  if (failed) warnings.push(`Workload membership could not be loaded for ${failed} backup(s). Some connections are unknown.`)
  return { ...buildTopology({ objects, backups, jobs, repositories, memberships }), warnings, sourceName, fetchedAt: new Date().toISOString() }
}
