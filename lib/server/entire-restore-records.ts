// Open Backup UI v1.2.0
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { validId } from '../investigation/model'
import type { SourcePoint } from '../recovery/options'

const id = z.string().refine(validId).transform(value => value.toLowerCase())
const label = z.string().trim().min(1).max(2048)
const placement = z.object({
  type:z.enum(['OriginalLocation','Customized']), destinationHost:z.object({name:label}).nullish(),
  folder:z.object({vmName:label.optional()}).nullish(), target:z.object({vmName:label.optional()}).nullish(),
  datastore:z.object({defaultDatastore:z.object({name:label}).nullish(), configurationFilesPath:label.nullish()}).nullish(),
})
const recordSchema = z.object({
  sourceKey:z.string().regex(/^[a-f0-9]{64}$/), sessionId:id, restorePointId:id, backupId:id,
  mode:z.enum(['OriginalLocation','Customized']), sourceVm:label, pointTime:z.string().max(100),
  targetVm:label.optional(), host:label.optional(), datastore:label.optional(), storagePath:label.optional(),
})
export type EntireRestoreRecord = z.infer<typeof recordSchema>

function file(sourceKey: string, sessionId: string) {
  if (!/^[a-f0-9]{64}$/.test(sourceKey) || !validId(sessionId)) throw new Error('Invalid restore session.')
  return path.join(process.cwd(), 'data', 'entire-restores', sourceKey, sessionId.toLowerCase() + '.json')
}

// Only the resolved native payload that VBR accepted can populate this receipt. Do not save credentials or the full request.
export async function saveEntireRestore(sourceKey: string, sessionId: string, point: SourcePoint, payload: unknown) {
  const spec = placement.parse(payload)
  const record = recordSchema.parse({sourceKey, sessionId, restorePointId:point.id, backupId:point.backupId,
    sourceVm:point.name, pointTime:point.creationTime, mode:spec.type,
    targetVm:spec.type === 'OriginalLocation' ? point.name : spec.folder?.vmName || spec.target?.vmName,
    host:spec.destinationHost?.name, datastore:spec.datastore?.defaultDatastore?.name, storagePath:spec.datastore?.configurationFilesPath})
  const target = file(sourceKey, sessionId), temp = target + '.' + randomUUID() + '.tmp'
  await fs.mkdir(path.dirname(target), {recursive:true,mode:0o700})
  try {
    await fs.writeFile(temp, JSON.stringify(record), {flag:'wx',mode:0o600})
    await fs.rename(temp, target)
  } finally { await fs.unlink(temp).catch(() => {}) }
}

export async function readEntireRestore(sourceKey: string, sessionId: string): Promise<EntireRestoreRecord | undefined> {
  try {
    const result = recordSchema.safeParse(JSON.parse(await fs.readFile(file(sourceKey, sessionId), 'utf8')))
    if (result.success && result.data.sourceKey === sourceKey && result.data.sessionId === sessionId.toLowerCase()) return result.data
  } catch { /* Optional display data; the authorized VBR session remains available. */ }
}
