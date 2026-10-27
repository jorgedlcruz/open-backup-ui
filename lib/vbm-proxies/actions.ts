import { z } from 'zod'
import { validId } from '../investigation/model'
export const actionSchema=z.enum(['rescan','enableMaintenance','disableMaintenance'])
export type ProxyAction=z.infer<typeof actionSchema>
const nonempty=z.string().min(1).max(4096)
export const credentialsSchema=z.union([
  z.object({username:nonempty,password:nonempty}).strict(),
  z.object({sshSettings:z.object({account:nonempty,accountPassword:nonempty,port:z.number().int().min(1).max(65535),fingerprint:nonempty,elevateAccountToRoot:z.boolean()}).strict()}).strict()
])
export type ProxyCredentials=z.infer<typeof credentialsSchema>
export function proxyAction(id:string,action:unknown,credentials?:unknown) {
  if(!validId(id))throw new Error('Invalid proxy ID.')
  const parsed=actionSchema.parse(action)
  return {path:`/v8/Proxies/${encodeURIComponent(id.toLowerCase())}/${parsed==='rescan' ? 'Rescan':`maintenance/${parsed==='enableMaintenance' ? 'enable':'disable'}`}`,
    body:parsed==='rescan' ? undefined:credentialsSchema.parse(credentials)}
}
