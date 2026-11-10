// Open Backup UI v1.0.2
import { z } from 'zod'
import type { RecoverySend } from '../server/vbr-recovery'
import { VbrRecoveryError } from './error'
import { linuxHostOptions,linuxCredential,usableLinuxCredential,type PrivateFlrConnection } from './linux-flr'

const pointSchema = z.object({
  id: z.string().uuid(), backupId: z.string().uuid(), name: z.string(), platformName: z.string(), creationTime: z.string(),
  guestOsFamily: z.string().nullish(), malwareStatus: z.string().nullish(), allowedOperations: z.array(z.string()),
})
export type SourcePoint = z.infer<typeof pointSchema>
const diskSchema = z.object({ uid: z.string().min(1), name: z.string().min(1), state: z.string(), capacity: z.number().optional() })
const mountSchema = z.object({ id: z.string().uuid(), name: z.string().nullish(), type: z.string(), isDefault: z.boolean().optional() })
const credentialSchema = z.object({ id: z.string().uuid(), username: z.string().nullish(), name: z.string().nullish() })

export async function findPoint(send: RecoverySend, id: string, backupId: string) {
  const point = pointSchema.safeParse(await send(`/api/v1/restorePoints/${id}`))
  if (!point.success || point.data.id !== id || point.data.backupId !== backupId) {
    throw new VbrRecoveryError('The selected restore point no longer belongs to this backup. Reopen the calendar.', 409)
  }
  const result=point.data
  if(result.guestOsFamily!=='Windows'&&result.guestOsFamily!=='Linux'){
    if(result.platformName==='WindowsPhysical')result.guestOsFamily='Windows'
    if(result.platformName==='LinuxPhysical'||result.platformName==='LinuxPhysicalPpc')result.guestOsFamily='Linux'
  }
  return result
}

export async function collect<T>(send: RecoverySend, path: string, schema: z.ZodType<T>, bodyPagination = false) {
  const data: T[] = []
  let skip = 0
  const pageSchema = z.object({ data: z.array(schema), pagination: z.object({ skip: z.number().int(), total: z.number().int() }) })
  do {
    const page = pageSchema.safeParse(bodyPagination
      ? await send(path, { method: 'POST', body: { pagination: { skip, limit: 200 } } })
      : await send(`${path}${path.includes('?') ? '&' : '?'}skip=${skip}&limit=200`))
    if (!page.success || page.data.pagination.skip !== skip) throw new VbrRecoveryError('VBR returned an invalid selection list.', 502)
    data.push(...page.data.data)
    skip += page.data.data.length
    if (skip >= page.data.pagination.total) return data
    if (!page.data.data.length || skip >= 20000) break
  } while (true)
  throw new VbrRecoveryError('The VBR selection list is incomplete.', 502)
}

export async function pointDisks(send: RecoverySend, id: string) {
  return (await collect(send, `/api/v1/restorePoints/${id}/disks`, diskSchema)).filter(disk => disk.state === 'Processed' || disk.state === 'PartiallyProcessed')
}

export function pointNetworks(send: RecoverySend, id: string) {
  return collect(send, `/api/v1/restorePoints/${id}/networkInfo`, z.object({ id: z.string().min(1), name: z.string() }), true)
}

export async function listGuestCredentials(send: RecoverySend) {
  return (await collect(send, '/api/v1/credentials', credentialSchema)).map(item => ({ id: item.id, name: item.name || item.username || item.id }))
}

export async function restoreOptions(send: RecoverySend, sourceKey: string, id: string, backupId: string, operation?: string,open?:PrivateFlrConnection) {
  const point = await findPoint(send, id, backupId)
  if (operation && !point.allowedOperations.includes(operation)) throw new VbrRecoveryError('VBR no longer allows this restore operation.', 409)
  const operations = operation ? [operation] : point.allowedOperations
  const warnings: string[] = []
  async function optional<T>(work: Promise<T[]>, message: string) {
    try { return await work } catch (error) {
      if (error instanceof VbrRecoveryError && error.status === 401) throw error
      warnings.push(message)
      return []
    }
  }
  const flr = operations.includes('StartFlrRestore')
  const linux=flr && point.guestOsFamily!=='Windows'
  const [disks, native, creds, networks] = await Promise.all([
    operations.some(op => op === 'StartFCDInstantRecovery' || op === 'StartDiskPublish')
      ? optional(pointDisks(send, id), 'VBR could not list the disks at this restore point.') : [],
    linux ? linuxHostOptions(open,id).catch(error=>{
      if(error instanceof VbrRecoveryError&&error.status===401)throw error
      warnings.push('VBR could not list mount hosts for this restore point.')
      return undefined
    }) : undefined,
    flr && point.guestOsFamily !== 'Linux' ? optional(listGuestCredentials(send), 'Saved guest credentials could not be listed.') : [],
    operations.some(op => ['StartEntireVmRestore', 'StartEntireVmRestoreHyperV', 'StartHvVMInstantRecovery', 'StartViVMInstantRecovery'].includes(op))
      ? optional(pointNetworks(send, id), 'The networks in this restore point could not be listed.') : [],
  ])
  const [servers,linuxCredentials]=await Promise.all([
    linux&&!native ? optional(collect(send,'/api/v1/backupInfrastructure/mountServers?typeFilter=Linux',mountSchema),'VBR could not list Linux mount servers.') : [],
    native?.originalHost.available ? optional(collect(send,'/api/v1/credentials?typeFilter=Linux&includeDefaultApplianceCreds=false',linuxCredential),
      'Saved guest credentials could not be listed.') : [],
  ])
  return { sourceKey, point, disks, networks, warnings,
    linuxMount:native&&{originalHost:native.originalHost,helperHosts:native.helperHosts,recommended:native.recommended,
      credentials:linuxCredentials.filter(usableLinuxCredential).map(row=>({id:row.id,name:row.username||row.id}))},
    mountServers: native?.mountServers??servers.filter(item=>item.type==='Linux').map(item => ({ id: item.id, type: item.type, name: item.name || `${item.isDefault ? 'Default ' : ''}${item.type} · ${item.id}` })),
    credentials: creds }
}
