import { z } from 'zod'
import { readCollection, TopologyRequestError } from '../topology/load'
import type { RecoveryPoint, WorkloadEvidence } from './model'

const pointSchema = z.object({ id: z.string().min(1), backupId: z.string().min(1), creationTime: z.string().datetime({ offset: true }), type: z.string().optional(), malwareStatus: z.string().optional() })
const objectSchema = z.object({ id: z.string().min(1), name: z.string(), platformName: z.string().optional() })
const backupSchema = z.object({ id: z.string(), repositoryId: z.string().optional(), repositoryName: z.string().optional() })

export async function loadWorkload(read: (path: string) => Promise<unknown>, sourceName: string, id: string): Promise<WorkloadEvidence> {
  const path = `/api/v1/backupObjects/${encodeURIComponent(id)}`
  const [object, collection] = await Promise.all([
    read(path).then(value => objectSchema.parse(value)),
    readCollection(read, `${path}/restorePoints`, pointSchema, 2000),
  ])
  if (object.id !== id) throw new Error('Unexpected workload identity')
  const warnings: string[] = []
  if (collection.truncated) warnings.push('Restore-point collection is incomplete; missing points cannot establish a policy failure.')
  const points: RecoveryPoint[] = collection.data
  const backupIds = [...new Set(points.map(p => p.backupId))]
  const repositories = new Map<string, { repositoryId?: string; repositoryName?: string }>()
  let cursor = 0
  let failed = 0
  await Promise.all(Array.from({ length: Math.min(4, backupIds.length) }, async () => {
    while (cursor < Math.min(backupIds.length, 100)) {
      const backupId = backupIds[cursor++]
      try {
        const backup = backupSchema.parse(await read(`/api/v1/backups/${encodeURIComponent(backupId)}`))
        if (backup.id !== backupId) throw new Error('Unexpected backup identity')
        const repositoryId = backup.repositoryId && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(backup.repositoryId) ? backup.repositoryId : undefined
        repositories.set(backupId, { repositoryId, repositoryName: backup.repositoryName })
      } catch (error) {
        if (error instanceof TopologyRequestError && error.status === 401) throw error
        failed++
      }
    }
  }))
  if (failed || backupIds.length > 100) warnings.push('Some backup destinations could not be resolved. Repository coverage is partial.')
  if (points.some(p => Date.parse(p.creationTime) > Date.now())) warnings.push('Future-dated restore points were returned; check source clock accuracy.')
  return { id, name: object.name, platform: object.platformName, sourceName, fetchedAt: new Date().toISOString(),
    complete: !collection.truncated, warnings, points: points.map(p => ({ ...p, ...repositories.get(p.backupId) })) }
}
