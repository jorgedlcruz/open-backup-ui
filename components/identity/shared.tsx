'use client'
// Open Backup UI v1.0.2
import { Trans , useI18n } from "@/components/providers/i18n-provider"
import { FilterSelect } from '@/components/operations/filter-facet'
import { FilterFields } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'
import ops from '@/components/operations/operations.module.css'
import { Export } from '@/components/vbm-jobs/shared'
import { permissionGroup } from '@/lib/identity/model'
import { cn } from '@/lib/utils'
import { Search } from 'lucide-react'
import { useState } from 'react'
import styles from './identity.module.css'

export async function identityRequest(path = '', signal?: AbortSignal, body?: unknown) {
  const response = await fetch(`/api/vbr/identity${path}`, { signal, cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) throw Error(data?.error || 'The identity request could not be completed. Refresh before retrying.')
  return data
}
export function Flag({ value, on = 'Enabled', off = 'Disabled' }: { value: boolean | null; on?: string; off?: string }) {
  return <span className={cn(ops.badge, value === true ? ops.success : value === false ? ops.neutral : ops.warning)}><Trans>{value === null ? 'Unknown' : value ? on : off}</Trans></span>
}
export function PermissionList({ permissions, complete, name }: { permissions: string[]; complete: boolean; name: string }) {
  const { t: uiText } = useI18n()

  const [query, setQuery] = useState(''), [group, setGroup] = useState('all')
  const groups = [...new Set(permissions.map(permissionGroup))].sort()
  const visible = permissions.filter(permission => permission.toLowerCase().includes(query.trim().toLowerCase()) && (group === 'all' || permissionGroup(permission) === group))
  return <div><FilterWorkspace label="Grid filters" search={<><label className={styles.search}><Search size={14} /><input aria-label={uiText("Search permissions")} value={query} placeholder={uiText("Find a permission…")} onChange={event => setQuery(event.target.value)} /></label></>} onClear={()=>{setQuery('');setGroup('all')}} filters={<FilterFields><FilterSelect label={"Permission category"} value={group} onValueChange={event => setGroup(event)}><option value="all"><Trans>{"All categories"}</Trans></option>{groups.map(value => <option key={value}>{value}</option>)}</FilterSelect></FilterFields>} actions={<><Export name={`${name}-permissions`} rows={visible.map(permission => ({ permission, category: permissionGroup(permission) }))} /></>}>
<p className={styles.hint}>{visible.length}<Trans>{" of "}</Trans>{permissions.length}<Trans>{" reported permissions"}</Trans>{!complete && ' · incomplete evidence'}<Trans>{". Categories group permission names for navigation; they are not an effective-access calculation."}</Trans></p>
{visible.length ? <div className={styles.permissionGrid}>{visible.map(permission => <div key={permission}><span className={ops.dot} /><span>{permission}</span></div>)}</div> : <div className={ops.empty}>{query || group !== 'all' ? 'No permissions match these filters.' : complete ? 'The API returned no permissions.' : 'Permission evidence is unavailable.'}</div>}
</FilterWorkspace></div>
}
