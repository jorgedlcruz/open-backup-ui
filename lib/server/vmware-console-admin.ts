import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { applicationOrigin, isSameApplicationOrigin } from './request-origin'
import { TopologyRequestError } from '../topology/load'

const problem = (message: string, code = 403) => new TopologyRequestError(message, code)
export const vmwareAdminEnabled = () => (process.env.HTTPS_ADMIN_TOKEN?.length ?? 0) >= 32
export function requireVmwareAdmin(request: {headers:Headers; nextUrl:URL}) {
  if (!vmwareAdminEnabled()) throw problem('Set HTTPS_ADMIN_TOKEN on the application server to manage VMware connections.')
  const origin = new URL(applicationOrigin(request))
  const local = ['localhost','[::1]'].includes(origin.hostname) || /^127\.\d+\.\d+\.\d+$/.test(origin.hostname)
  if (origin.protocol !== 'https:' && !local) throw problem('Use HTTPS or a loopback address to manage VMware connections.')
  if (request.headers.get('sec-fetch-site') === 'cross-site' || !isSameApplicationOrigin(request)) throw problem('Use the connected Open Backup UI to perform this action.')
  const supplied = request.headers.get('x-https-admin-token') || ''
  const hash = (value:string) => createHash('sha256').update(value).digest()
  if (!supplied || !timingSafeEqual(hash(supplied), hash(process.env.HTTPS_ADMIN_TOKEN!))) throw problem('The HTTPS administration token is not valid.')
}

const operation = z.object({sourceKey:z.string().regex(/^[a-f0-9]{64}$/),id:z.string().uuid(),hostname:z.string().min(1).max(253),port:z.number().int().min(1).max(65535)})
export const vmwareSettingsAction = z.discriminatedUnion('action', [
  operation.extend({action:z.literal('save'), revision:z.string().uuid().nullable(), username:z.string().trim().min(1).max(512),
    password:z.string().max(4096),trust:z.enum(['keep','system','custom']),caPem:z.string().max(65536).optional()}).strict(),
  operation.extend({action:z.literal('remove'),revision:z.string().uuid()}).strict(),
])
export async function readVmwareSettings(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw problem('Send the VMware connection settings as JSON.', 415)
  const limit = 96 * 1024, reader = request.body?.getReader()
  if (!reader || Number(request.headers.get('content-length')) > limit) throw problem('Invalid VMware connection settings.', 400)
  const parts:Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const {done,value} = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) { await reader.cancel(); throw problem('Invalid VMware connection settings.', 413) }
      parts.push(value)
    }
    return vmwareSettingsAction.parse(JSON.parse(Buffer.concat(parts).toString('utf8')))
  } catch (e) { if (e instanceof TopologyRequestError) throw e; throw problem('Invalid VMware connection settings.', 400) }
  finally { reader.releaseLock() }
}
