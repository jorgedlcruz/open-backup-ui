'use client'
import { useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loading, useEvidence } from '@/components/investigation/shared'
import { assignedPermissions, assignments, isGroup, roleKind, yesNo, type RoleDetail, type RoleRow, type Snapshot, type User } from '@/lib/identity/model'
import { Flag, identityRequest, PermissionList } from './shared'
import styles from './identity.module.css'

export function RoleDialog({ role, snapshot, onClose }: { role: RoleRow; snapshot: Snapshot; onClose: () => void }) {
  const load = useCallback((signal: AbortSignal) => identityRequest(`?roleId=${encodeURIComponent(role.id)}&sourceKey=${snapshot.sourceKey}`, signal) as Promise<RoleDetail>, [role.id, snapshot.sourceKey])
  const { data, loading, error } = useEvidence(load, 0)
  const assigned = assignments(role, snapshot.users)
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}><DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto ph-no-capture"><DialogHeader><DialogTitle>{role.name || role.id}</DialogTitle><DialogDescription>{role.description || 'No role description reported.'}</DialogDescription></DialogHeader>
    {loading ? <Loading>Reading role permissions and scope…</Loading> : error || !data ? <div role="alert" className={styles.callout}>{error || 'Role details are unavailable.'}</div> : <>
      <dl className={styles.detailFacts}><div><dt>Role kind</dt><dd>{roleKind(data.role)}</dd></div><div><dt>Explicit assignments</dt><dd>{assigned.users.length}{!assigned.complete && ' or more'} users/groups</dd></div><div><dt>Role ID</dt><dd>{data.role.id}</dd></div><div><dt>Source</dt><dd>{snapshot.sourceName}</dd></div></dl>
      <div className={styles.assignmentList}><h3>Assigned users & groups</h3>{assigned.users.map(user => <span key={user.id}>{user.name || user.id}</span>)}{!assigned.users.length && <p className={styles.hint}>{assigned.complete ? 'No explicit assignments in the returned inventory.' : 'Assignments are unknown because account evidence is incomplete.'}</p>}<Button variant="outline" size="sm" asChild><Link href={`/administration/identity/users?role=${role.id}`}>Investigate assigned accounts</Link></Button></div>
      <h3 className={styles.sectionTitle}>Permission inventory</h3>{data.permissions.error && <p className={styles.callout}>{data.permissions.error}</p>}<PermissionList permissions={data.permissions.data} complete={data.permissions.complete} name="identity-role" />
      <h3 className={styles.sectionTitle}>Access scopes</h3>{data.scopes.error && <p className={styles.callout}>{data.scopes.error}</p>}{data.role.isBuiltIn === true ? <p className={styles.hint}>This is a built-in role. The custom-role scope resource does not apply.</p> : <div className={styles.scopes}>{data.scopes.data.map(scope => <article key={scope.name}><h4>{scope.name}</h4><strong>{scope.value}</strong><p>{scope.detail}</p></article>)}</div>}
      <p className={styles.hint}>Scope entries are summarized. Permission names alone do not prove access to every workload; VBR evaluates role scopes and group membership.</p>
    </>}<div className={styles.dialogEnd}><Button variant="outline" onClick={onClose}>Close</Button></div>
  </DialogContent></Dialog>
}
export function UserDialog({ user, snapshot, onClose, onRole }: { user: User; snapshot: Snapshot; onClose: () => void; onRole: (role: RoleRow) => void }) {
  const grants = assignedPermissions(user, snapshot.roles.data)
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}><DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto ph-no-capture"><DialogHeader><DialogTitle>{user.name || user.id}</DialogTitle><DialogDescription>Account evidence from {snapshot.sourceName}. Group members and directory status are not expanded.</DialogDescription></DialogHeader>
    <dl className={styles.detailFacts}><div><dt>Principal type</dt><dd>{user.type || 'Unknown'}{isGroup(user) && ' · group'}</dd></div><div><dt>MFA enabled (API)</dt><dd><Flag value={user.mfaEnabled} /></dd></div><div><dt>Service account</dt><dd>{yesNo(user.isServiceAccount)}</dd></div><div><dt>Account enabled flag</dt><dd>{user.enabled === null ? 'Not reported by this API' : yesNo(user.enabled)}</dd></div><div><dt>Account ID</dt><dd>{user.id}</dd></div><div><dt>Assigned roles</dt><dd>{user.roles === null ? 'Unknown' : user.roles.length}</dd></div></dl>
    <div className={styles.assignmentList}><h3>Role assignments</h3>{user.roles?.map(role => { const match = snapshot.roles.data.find(item => item.id === role.id); return <Button key={role.id} variant="outline" size="sm" disabled={!match} onClick={() => { if (match) onRole(match) }}>{role.name || role.id}</Button> })}{user.roles?.length === 0 && <p>No roles reported.</p>}</div>
    <h3 className={styles.sectionTitle}>Permissions from assigned roles</h3><p className={styles.hint}>This union deduplicates reported permission names. It does not expand group membership, operating-system administrator access, or custom resource scopes.</p><PermissionList permissions={grants.permissions} complete={grants.complete} name="identity-account" />
    <div className={styles.dialogEnd}><Button variant="outline" onClick={onClose}>Close</Button></div>
  </DialogContent></Dialog>
}
