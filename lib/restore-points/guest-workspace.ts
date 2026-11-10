// Open Backup UI v1.2.0
import { z } from 'zod'
import type { GuestSearch, GuestTask, GuestDownload } from './workflow'

const cartEntry = z.object({ path: z.string().min(1).max(32767), type: z.enum(['Folder', 'File', 'Link']) })
export type CartEntry = z.infer<typeof cartEntry>
const task = z.object({ id: z.string().uuid(), state: z.string().optional(), result: z.string().optional(), message: z.string().optional(), progressPercent: z.number().optional() })
const search = task.extend({ searchKey: z.string().min(1), query: z.string().min(1), path: z.string(), recursive: z.boolean() })
const restoreReceipt = z.object({
  phase: z.enum(['sending', 'unconfirmed', 'accepted']), count: z.number().int().positive(),
  target: z.string().optional(), folder: z.string().optional(), policy: z.enum(['Keep', 'Overwrite', 'PermissionOnly']),
})
export type MountedSearch = GuestSearch & { query: string; path: string; recursive: boolean }
export type GuestWorkspace = { path?: string; cart: CartEntry[]; task?: GuestTask; search?: MountedSearch; download?: GuestDownload; restore?: z.infer<typeof restoreReceipt> }
export const workspaceKey = (source: string, mount: string) => `vbr.guest-files.1/${source}/${mount}`

export function readWorkspace(value: string | null): GuestWorkspace {
  try {
    const model = z.object({ path: z.string().max(32767).optional(), cart: z.array(cartEntry), task: task.extend({ restoreKey: z.string().optional() }).optional(), search: search.optional(), restore: restoreReceipt.optional(),
      download: task.extend({ downloadKey: z.string().min(1), count: z.number().int().positive().optional(), bearerOnly: z.boolean().optional() }).optional() })
    const workspace = model.parse(JSON.parse(value || '{}'))
    if (workspace.restore?.phase === 'sending') workspace.restore.phase = 'unconfirmed'
    return workspace
  } catch { return { cart: [] } }
}

function comparable(path: string, separator: string) {
  return separator === '/' ? path : path.toLowerCase()
}

export function samePath(left: string, right: string, separator: string) {
  return comparable(left, separator) === comparable(right, separator)
}

export function isBelow(path: string, parent: string, separator: string) {
  const value = comparable(path, separator)
  const prefix = comparable(parent, separator)
  return value !== prefix && value.startsWith(prefix.endsWith(separator) ? prefix : prefix + separator)
}

export function addToCart(cart: CartEntry[], entry: CartEntry, separator: string): CartEntry[] {
  if (cart.some(item => samePath(item.path, entry.path, separator) || (item.type === 'Folder' && isBelow(entry.path, item.path, separator)))) return cart
  const retained = entry.type === 'Folder' ? cart.filter(item => !isBelow(item.path, entry.path, separator)) : cart
  return [...retained, entry]
}

export function guestCrumbs(path: string, separator: string) {
  const parts = path.split(separator).filter(Boolean)
  let prefix = separator === '/' ? '/' : ''
  return parts.map((label, index) => {
    prefix += (index && !prefix.endsWith(separator) ? separator : '') + label
    if (index === 0 && separator !== '/' && /^[a-z]:$/i.test(label)) prefix += separator
    return { label, path: prefix }
  })
}

export function isTaskRunning(task?: GuestTask) {
  return !!task?.id && ['starting', 'working', 'stopping'].includes((task.state || '').toLowerCase())
}

export function guestRestoreBusy(workspace: GuestWorkspace) {
  return isTaskRunning(workspace.task) || workspace.restore?.phase === 'sending' || workspace.restore?.phase === 'unconfirmed'
}

export function searchHasResults(task?: GuestTask) {
  return task?.state === 'Stopped' && (task.result === 'Success' || task.result === 'Warning')
}
