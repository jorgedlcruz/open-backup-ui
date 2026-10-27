import { createHash } from 'node:crypto'
import { z } from 'zod'
import { idSchema, roleSchema, userSchema, userTypes } from './model'
import { IdentityError } from './load'

const revision = z.string().regex(/^[a-f0-9]{64}$/)
const common = { sourceKey: revision }
const target = { ...common, id: idSchema, expectedRevision: revision }
const roleIds = z.array(idSchema).min(1).max(100).refine(ids => new Set(ids).size === ids.length, 'Select each role once.')
export const actionSchema = z.discriminatedUnion('action', [
  z.object({ ...common, action: z.literal('add'), name: z.string().trim().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]+$/), type: z.enum(userTypes), roleIds, isServiceAccount: z.boolean() }).strict(),
  z.object({ ...target, action: z.literal('roles'), roleIds }).strict(),
  z.object({ ...target, action: z.literal('delete') }).strict(),
  z.object({ ...target, action: z.literal('reset-mfa') }).strict(),
  z.object({ ...target, action: z.literal('service'), enabled: z.boolean() }).strict(),
  z.object({ ...common, action: z.literal('mfa'), enabled: z.boolean(), expectedEnabled: z.boolean() }).strict(),
])
export type ActionInput = z.infer<typeof actionSchema>
export type Execute = (path: string, method?: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: unknown) => Promise<unknown>
export function userRevision(user: z.infer<typeof userSchema>) {
  return createHash('sha256').update(JSON.stringify([user.id, user.name, user.type, user.isServiceAccount, user.mfaEnabled, user.roles?.map(role => role.id).sort() ?? null])).digest('hex')
}
export async function executeAction(execute: Execute, input: ActionInput) {
  if (input.action === 'mfa') {
    const current = z.object({ mfaEnabled: z.boolean() }).parse(await execute('/api/v1/security/settings'))
    if (current.mfaEnabled !== input.expectedEnabled) throw new IdentityError('MFA settings changed. Refresh and review the current state before trying again.', 409)
    await execute('/api/v1/security/settings', 'PUT', { mfaEnabled: input.enabled })
    return { accepted: true }
  }
  const checkAccount = async () => {
    if (input.action === 'add') return
    const current = userSchema.parse(await execute(`/api/v1/security/users/${input.id}`))
    if (current.id !== input.id || userRevision(current) !== input.expectedRevision) throw new IdentityError('This account changed. Refresh and review its current settings before trying again.', 409)
  }
  await checkAccount()
  if (input.action === 'add' || input.action === 'roles') {
    // Resolve submitted IDs against this source; never trust caller-supplied role names or permissions.
    const roles = []
    for (const id of input.roleIds) {
      const role = roleSchema.parse(await execute(`/api/v1/security/roles/${id}`))
      if (role.id !== id) throw new IdentityError('The source returned a different role.', 409)
      roles.push({ id: role.id, name: role.name, ...(role.description ? { description: role.description } : {}) })
    }
    if (input.action === 'add') await execute('/api/v1/security/users', 'POST', { name: input.name, type: input.type, roles, isServiceAccount: input.isServiceAccount })
    else { await checkAccount(); await execute(`/api/v1/security/users/${input.id}/roles`, 'PUT', { roles }) }
  } else if (input.action === 'delete') await execute(`/api/v1/security/users/${input.id}`, 'DELETE')
  else if (input.action === 'reset-mfa') await execute(`/api/v1/security/users/${input.id}/resetMFA`, 'POST')
  else await execute(`/api/v1/security/users/${input.id}/changeServiceAccountMode`, 'POST', { isServiceAccountEnable: input.enabled })
  return { accepted: true }
}
