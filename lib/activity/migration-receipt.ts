import { z } from 'zod'
import { validId } from '../investigation/model'
import type { Mount } from './model'

const guid = z.string().refine(validId)
const receiptSchema = z.object({
  mount: z.object({
    id: guid, sessionId: guid, kind: z.enum(['vSphere', 'hyperV']), state: z.string(),
    name: z.string().optional(), host: z.string().optional(), backup: z.string().optional(), pointTime: z.string().optional(),
    // Preserve the original placement for the map after the mount disappears.
    // Power is live inventory evidence and must be read again.
    instantVm: z.object({
      platform:z.enum(['VMware','HyperV']), host:z.string().optional(), manager:z.string().optional(), cluster:z.string().optional(),
      backupName:z.string().optional(), repository:z.string().optional(), sourceVm:z.string().optional(), writeCache:z.string().optional(),
    }).optional(),
  }),
  status: z.enum(['submitting', 'accepted', 'unknown']),
  childId: guid.optional(),
  previousChildId: guid.optional(),
  destination: z.object({host: z.string().optional(), datastore: z.string().optional()}),
})

export type MigrationReceipt = z.infer<typeof receiptSchema>
const memory = new Map<string, MigrationReceipt[]>()
export const migrationReceiptEvent = 'vbr-instant-migration-changed'
const keyFor = (source: string, session: string) => 'vbr.instant-migration.1/' + source + '/' + session

export function migrationReceipts(source: string, session: string): MigrationReceipt[] {
  if (typeof window === 'undefined' || !source || !validId(session)) return []
  const key = keyFor(source, session)
  const existing = memory.get(key)
  if (existing) return existing
  try {
    const result = receiptSchema.array().parse(JSON.parse(sessionStorage.getItem(key) || '[]'))
    // A refreshed tab cannot tell whether an interrupted POST reached VBR.
    return result.filter(entry => entry.mount.sessionId === session)
      .map(entry => entry.status === 'submitting' ? {...entry, status:'unknown'} : entry)
  } catch { return [] }
}

export function storeMigration(source: string, mount: Mount, receipt?: MigrationReceipt) {
  const key = keyFor(source, mount.sessionId)
  const entries = migrationReceipts(source, mount.sessionId).filter(entry => entry.mount.id !== mount.id || entry.mount.kind !== mount.kind)
  if (receipt) entries.push(receiptSchema.parse(receipt))
  memory.set(key, entries)
  try {
    if (entries.length) sessionStorage.setItem(key, JSON.stringify(entries))
    else sessionStorage.removeItem(key)
  } catch { /* The in-memory copy still protects the open tab. */ }
  window.dispatchEvent(new Event(migrationReceiptEvent))
}

export function readPendingMigrationMounts(source: string, session: string): Mount[] {
  return migrationReceipts(source, session).map(entry => ({...entry.mount, state: 'Not reported'}))
}
