import { z } from 'zod'

export const idSchema = z.string().uuid().transform(value => value.toLowerCase())
const flag = z.unknown().transform(value => typeof value === 'boolean' ? value : null)
const text = z.unknown().transform(value => typeof value === 'string' ? value : '')
export const roleSchema = z.object({ id: idSchema, name: text, description: text, isBuiltIn: flag })
export const userSchema = z.object({ id: idSchema, name: text, type: text, roles: z.array(roleSchema).nullish().transform(value => value ?? null), isServiceAccount: flag, mfaEnabled: flag, enabled: flag })
export type Role = z.infer<typeof roleSchema>
export type User = z.infer<typeof userSchema> & { revision: string }
export type Evidence<T> = { data: T; complete: boolean; error: string | null }
export type RoleRow = Role & { permissions: Evidence<string[]> }
export type Snapshot = { users: Evidence<User[]>; roles: Evidence<RoleRow[]>; mfaEnabled: boolean | null; settingsError: string | null; sourceName: string; sourceKey: string; fetchedAt: string }
export type Scope = { name: string; value: string; detail: string }
export type RoleDetail = { role: Role; permissions: Evidence<string[]>; scopes: Evidence<Scope[]>; sourceKey: string }
export const identityPermissions = new Set(['CreateUser', 'DeleteUser', 'UpdateUser', 'ResetUserMfa', 'UpdateUsersSettings', 'CreateCustomRole', 'UpdateCustomRole', 'DeleteCustomRole'])
export const userTypes = ['InternalUser', 'InternalGroup', 'ExternalUser', 'ExternalGroup'] as const
export const yesNo = (value: boolean | null) => value === null ? 'Unknown' : value ? 'Yes' : 'No'
export const roleKind = (role: Role) => role.isBuiltIn === true ? 'Built-in' : role.isBuiltIn === false ? 'Custom' : 'Unknown'
export const isGroup = (user: Pick<User, 'type'>) => /Group$/.test(user.type)
export function assignedPermissions(user: User, roles: RoleRow[]) {
  const found = (user.roles || []).map(role => roles.find(item => item.id === role.id))
  return { permissions: [...new Set(found.flatMap(role => role?.permissions.data || []))].sort(), complete: user.roles !== null && found.every(role => role?.permissions.complete) }
}
export function userIssues(user: User, roles: RoleRow[]): string[] {
  const permissions = assignedPermissions(user, roles), issues: string[] = []
  if (user.isServiceAccount === true) issues.push('service')
  if (!isGroup(user) && user.isServiceAccount === false && user.mfaEnabled === false) issues.push('mfa-off')
  if (user.roles?.length === 0) issues.push('no-roles')
  if (permissions.permissions.some(permission => identityPermissions.has(permission))) issues.push('identity-admin')
  if (user.mfaEnabled === null || user.isServiceAccount === null || !user.type || !permissions.complete) issues.push('unknown')
  return issues
}
export function assignments(role: Role, users: Evidence<User[]>) {
  const matches = users.data.filter(user => user.roles?.some(item => item.id === role.id))
  return { users: matches, complete: users.complete && users.data.every(user => user.roles !== null) }
}
export function roleIssues(role: RoleRow, users: Evidence<User[]>): string[] {
  const assigned = assignments(role, users), issues: string[] = []
  if (role.permissions.data.some(permission => identityPermissions.has(permission))) issues.push('identity-admin')
  if (role.permissions.complete && role.permissions.data.length === 0) issues.push('no-permissions')
  if (assigned.complete && assigned.users.length === 0) issues.push('unassigned')
  if (!role.permissions.complete || !assigned.complete || role.isBuiltIn === null) issues.push('unknown')
  return issues
}
export const userIssueLabels: Record<string,string> = { all: 'All accounts', 'mfa-off': 'MFA not enabled', service: 'Service accounts', 'identity-admin': 'Identity management', 'no-roles': 'No assigned roles', unknown: 'Unknown evidence' }
export const roleIssueLabels: Record<string,string> = { all: 'All roles', 'identity-admin': 'Identity management', unassigned: 'Unassigned roles', 'no-permissions': 'No permissions', unknown: 'Unknown evidence' }
export type Filters = { query: string; issue: string; type: string; role: string; mfa: string }
export const emptyFilters: Filters = { query: '', issue: 'all', type: 'all', role: 'all', mfa: 'all' }
export function filterUsers(snapshot: Snapshot, filters: Filters) {
  const query = filters.query.trim().toLowerCase()
  return snapshot.users.data.filter(user => (filters.issue === 'all' || userIssues(user, snapshot.roles.data).includes(filters.issue)) && (filters.type === 'all' || user.type === filters.type) && (filters.role === 'all' || user.roles?.some(role => role.id === filters.role)) && (filters.mfa === 'all' || (user.mfaEnabled === null ? 'unknown' : user.mfaEnabled ? 'enabled' : 'disabled') === filters.mfa) && `${user.name} ${user.id} ${user.type} ${user.roles?.map(role => `${role.name} ${role.description}`).join(' ')}`.toLowerCase().includes(query))
}
export function filterRoles(snapshot: Snapshot, filters: Filters) {
  const query = filters.query.trim().toLowerCase()
  return snapshot.roles.data.filter(role => (filters.issue === 'all' || roleIssues(role, snapshot.users).includes(filters.issue)) && (filters.type === 'all' || roleKind(role) === filters.type) && `${role.name} ${role.id} ${role.description} ${role.permissions.data.join(' ')}`.toLowerCase().includes(query))
}
export function permissionGroup(permission: string) {
  if (identityPermissions.has(permission)) return 'Identity management'
  if (/restore|rollback|failover|failback/i.test(permission)) return 'Restore & recovery'
  if (/^(View|Get|Read|List|Browse|Query)/.test(permission)) return 'Read & inspect'
  return 'Other operations'
}
