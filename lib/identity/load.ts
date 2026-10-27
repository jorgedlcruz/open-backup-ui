import { z } from 'zod'
import { roleSchema, userSchema, type Evidence, type Role, type RoleDetail, type RoleRow, type Scope, type Snapshot, type User } from './model'

export class IdentityError extends Error { constructor(message: string, public status = 502) { super(message) } }
export type Read = (path: string) => Promise<unknown>
const issue = (label: string, error: unknown) => `${label} could not be read${error instanceof IdentityError && error.status === 403 ? ' with this account’s permissions' : ''}. Available records are retained; missing evidence is unknown.`
export async function collection<T extends { id: string }>(read: Read, path: string, schema: z.ZodType<T>, label: string, max = 5000): Promise<Evidence<T[]>> {
  const values = new Map<string,T>(); let skip = 0
  try {
    for (let page = 0; page < 100; page++) {
      const result = z.object({ data: z.array(schema), pagination: z.object({ total: z.number().int().nonnegative().optional() }).optional() }).parse(await read(`${path}?skip=${skip}&limit=200`))
      const before = values.size
      for (const row of result.data) if (values.size < max) values.set(row.id, row)
      skip += result.data.length
      const total = result.pagination?.total
      if (result.data.length && (values.size === before || values.size < skip)) break
      if (total !== undefined && skip >= total) return { data: [...values.values()], complete: skip <= max, error: skip > max ? `${label} reached the ${max.toLocaleString()} record limit.` : null }
      if (!result.data.length) return { data: [...values.values()], complete: total === undefined || skip >= total, error: total !== undefined && skip < total ? `${label} ended before the reported total.` : null }
      if (total === undefined && result.data.length < 200) return { data: [...values.values()], complete: skip <= max, error: skip > max ? `${label} reached the record limit.` : null }
      if (values.size >= max) break
    }
    return { data: [...values.values()], complete: false, error: `${label} are partial because pagination repeated or reached the view limit.` }
  } catch (error) {
    if (error instanceof IdentityError && error.status === 401) throw error
    return { data: [...values.values()], complete: false, error: issue(label, error) }
  }
}
export async function permissions(read: Read, id: string): Promise<Evidence<string[]>> {
  try {
    const result = z.object({ roleId: z.string().uuid(), permissions: z.array(z.string().min(1).max(300)).max(20000) }).parse(await read(`/api/v1/security/roles/${id}/permissions`))
    if (result.roleId.toLowerCase() !== id.toLowerCase()) throw Error('Mismatched role')
    return { data: [...new Set(result.permissions)].sort(), complete: true, error: null }
  } catch (error) {
    if (error instanceof IdentityError && error.status === 401) throw error
    return { data: [], complete: false, error: issue('Role permissions', error) }
  }
}
export async function loadIdentity(read: Read, sourceName: string, sourceKey: string, revision: (user: z.infer<typeof userSchema>) => string): Promise<Snapshot> {
  const [users, roles, settings] = await Promise.all([
    collection(read, '/api/v1/security/users', userSchema, 'Accounts'),
    collection(read, '/api/v1/security/roles', roleSchema, 'Roles'),
    read('/api/v1/security/settings').then(value => ({ value: z.object({ mfaEnabled: z.boolean().nullish() }).parse(value).mfaEnabled ?? null, error: null as string | null })).catch(error => { if (error instanceof IdentityError && error.status === 401) throw error; return { value: null, error: issue('MFA settings', error) } }),
  ])
  const roleRows: RoleRow[] = roles.data.map(role => ({ ...role, permissions: { data: [], complete: false, error: 'Permissions not loaded: the summary is limited to 200 roles. Open the role to inspect it.' } }))
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(4, roleRows.length) }, async () => {
    while (cursor < Math.min(200, roleRows.length)) { const role = roleRows[cursor++]; role.permissions = await permissions(read, role.id) }
  }))
  return { users: { ...users, data: users.data.map(user => ({ ...user, revision: revision(user) })) as User[] }, roles: { ...roles, data: roleRows }, mfaEnabled: settings.value, settingsError: settings.error, sourceName, sourceKey, fetchedAt: new Date().toISOString() }
}
const object = (value: unknown): Record<string,unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {}
const bool = (value: unknown) => typeof value === 'boolean' ? value : null
const labels = (value: unknown, fields: string[]) => Array.isArray(value) ? value.map(item => {
  const row = object(item)
  return fields.map(field => row[field]).filter(value => typeof value === 'string' && value).join(' · ') || 'Unnamed entry'
}).join('; ') || 'No additional entries' : 'Entries not reported'
function workloads(value: unknown) {
  if (!Array.isArray(value)) return 'Entries not reported'
  return value.map(item => {
    const row = object(item)
    const entries = ['inventoryObjects', 'backups', 'computers', 'fileShares', 'objectStorageServer', 'jobs'].filter(field => Array.isArray(row[field]))
    return `${typeof row.type === 'string' ? row.type : 'Unknown workload type'}: ${entries.length ? entries.map(field => labels(row[field], ['name', 'hostName', 'type', 'id', 'objectId', 'backupName', 'backupId', 'jobName', 'jobId', 'serverName', 'serverId', 'folder'])).join('; ') : 'Entries not reported'}`
  }).join('; ') || 'No additional workload entries'
}
export function scopeSummary(value: unknown, id: string): Scope[] {
  const data = object(value)
  if (typeof data.id !== 'string' || data.id.toLowerCase() !== id.toLowerCase()) throw Error('Mismatched custom role')
  const inventory = object(data.inventoryScope), repositories = object(data.repositoryScope), restore = object(data.restorePermissionsScope), sources = object(restore.restoreBackupScope), options = object(restore.restoreOptions), target = object(data.restoreTargetScope), targets = object(target.restoreTargets)
  const scope = (name: string, flag: unknown, all: string, limited: string, detail: string): Scope => ({ name, value: bool(flag) === null ? 'Not reported' : flag ? all : limited, detail })
  return [
    scope('Manage backups', data.manageBackups, 'Allowed', 'Not allowed', 'Create and manage backup jobs.'),
    scope('Manage restores', data.manageRestores, 'Allowed', 'Not allowed', 'Restore from existing backups.'),
    scope('Inventory', inventory.entireInventory, 'Entire inventory', 'Restricted inventory', inventory.entireInventory === true ? 'All inventory objects are in scope.' : workloads(inventory.workloads)),
    scope('Repositories', repositories.allRepositories, 'All repositories', 'Restricted repositories', repositories.allRepositories === true ? 'All repositories are in scope.' : labels(repositories.repositories, ['repositoryName', 'repositoryId'])),
    scope('Restore sources', sources.entireBackupScope, 'All available backups', 'Owned backups + additional sources', sources.entireBackupScope === true ? 'All available backup sources are in scope.' : workloads(sources.backupSources)),
    scope('Restore options', options.allOptions, 'All restore types', 'Restricted restore types', options.allOptions === true ? 'All restore types are in scope.' : labels(options.restoreOptions, ['name', 'group', 'description'])),
    scope('Restore targets', target.entireBackupScope, 'Any location', 'Restricted targets', target.entireBackupScope === true ? 'Any restore location is in scope.' : targets.originalLocation === true ? 'Original location only' : workloads(targets.workloads)),
  ]
}
export async function loadRole(read: Read, id: string, sourceKey: string): Promise<RoleDetail> {
  const role: Role = roleSchema.parse(await read(`/api/v1/security/roles/${id}`))
  if (role.id !== id) throw new IdentityError('The source returned a different role.')
  const [grants, scopes] = await Promise.all([
    permissions(read, id),
    role.isBuiltIn === false ? read(`/api/v1/security/roles/${id}/details`).then(value => ({ data: scopeSummary(value, id), complete: true, error: null })).catch(error => { if (error instanceof IdentityError && error.status === 401) throw error; return { data: [], complete: false, error: issue('Custom role scopes', error) } }) : Promise.resolve({ data: [], complete: role.isBuiltIn === true, error: role.isBuiltIn === null ? 'Role kind is unreported; custom scopes were not queried.' : null }),
  ])
  return { role, permissions: grants, scopes, sourceKey }
}
