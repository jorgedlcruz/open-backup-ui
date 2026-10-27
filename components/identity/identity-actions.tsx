'use client'
import { useRef, useState } from 'react'
import { Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { userTypes, roleKind, type Snapshot, type User } from '@/lib/identity/model'
import { identityRequest } from './shared'
import styles from './identity.module.css'

export type IdentityAction = { kind: 'add' | 'roles' | 'delete' | 'reset-mfa' | 'service' | 'mfa'; user?: User; enabled?: boolean }
export function IdentityActionDialog({ action, snapshot, onClose, onSaved }: { action: IdentityAction; snapshot: Snapshot; onClose: () => void; onSaved: (accepted: boolean) => void }) {
  const [name, setName] = useState(''), [type, setType] = useState<string>('InternalUser'), [service, setService] = useState(false)
  const [selected, setSelected] = useState(action.user?.roles?.map(role => role.id) || []), [query, setQuery] = useState('')
  const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null), busy = useRef(false)
  const editingRoles = action.kind === 'roles' || action.kind === 'add'
  const unresolved = !!action.user?.roles?.some(role => !snapshot.roles.data.some(item => item.id === role.id))
  const titles = { add: 'Add user or group', roles: 'Edit assigned roles', delete: 'Delete user or group', 'reset-mfa': 'Reset MFA', service: `${action.enabled ? 'Enable' : 'Disable'} service account mode`, mfa: `${action.enabled ? 'Enable' : 'Disable'} MFA enforcement` }
  const valid = (!editingRoles || (snapshot.roles.complete && selected.length > 0 && !unresolved)) && (action.kind !== 'add' || (!!name.trim() && name.length <= 256)) && (action.kind !== 'roles' || selected.slice().sort().join() !== action.user?.roles?.map(role => role.id).sort().join())
  async function submit() {
    if (busy.current || !valid || error) return
    busy.current = true; setPending(true)
    try {
      const target = action.user ? { id: action.user.id, expectedRevision: action.user.revision } : {}
      const body = { sourceKey: snapshot.sourceKey, action: action.kind, ...target,
        ...(action.kind === 'add' ? { name: name.trim(), type, roleIds: selected, isServiceAccount: service } : {}),
        ...(action.kind === 'roles' ? { roleIds: selected } : {}),
        ...(action.kind === 'service' ? { enabled: action.enabled } : {}),
        ...(action.kind === 'mfa' ? { enabled: action.enabled, expectedEnabled: snapshot.mfaEnabled } : {}),
      }
      await identityRequest('', undefined, body); onSaved(true)
    } catch (error) { setError(error instanceof Error ? error.message : 'The action could not be confirmed. Refresh before retrying.') }
    finally { busy.current = false; setPending(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open && !pending) onClose() }}><DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto ph-no-capture" onInteractOutside={event => { if (pending) event.preventDefault() }} onEscapeKeyDown={event => { if (pending) event.preventDefault() }}><DialogHeader><DialogTitle>{titles[action.kind]}</DialogTitle><DialogDescription>Review this change on {snapshot.sourceName}{action.user ? ` for ${action.user.name || action.user.id}` : ''}.</DialogDescription></DialogHeader>
    {error && <div className={styles.callout} role="alert"><ShieldAlert size={18} /><p>{error}</p></div>}
    <fieldset disabled={pending || !!error} className={styles.actionForm}>
      {action.kind === 'add' && <><label>Account name<Input autoComplete="off" value={name} maxLength={256} placeholder="DOMAIN\account or user@domain" onChange={event => setName(event.target.value)} /></label><label>Account type<select value={type} onChange={event => setType(event.target.value)}>{userTypes.map(value => <option key={value}>{value}</option>)}</select></label><p className={styles.hint}>Adds an existing principal to VBR access settings. It does not create an operating-system or directory account.</p><label className={styles.checkbox}><Checkbox checked={service} onCheckedChange={value => setService(value === true)} />This is a service account (disables MFA)</label></>}
      {editingRoles && <><h3>Assigned roles</h3>{action.kind === 'roles' && <p className={styles.hint}>Current: {action.user?.roles?.map(role => role.name || role.id).join(', ') || 'Not reported'}</p>}<Input aria-label="Filter available roles" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a role…" />{unresolved && <p className={styles.hint}>An assigned role is absent from the loaded catalog. Refresh before editing to avoid losing that assignment.</p>}<div className={styles.roleChoices}>{snapshot.roles.data.filter(role => `${role.name} ${role.description}`.toLowerCase().includes(query.toLowerCase())).map(role => <label key={role.id}><Checkbox checked={selected.includes(role.id)} onCheckedChange={checked => setSelected(checked === true ? [...selected, role.id] : selected.filter(id => id !== role.id))} /><span><strong>{role.name || role.id}</strong><small>{roleKind(role)} · {role.description || 'No description reported'}</small></span></label>)}</div><p className={styles.hint}>{selected.length} role(s) selected. At least one role is required.</p></>}
      {action.kind === 'delete' && <p>Remove this principal’s explicit access entry from VBR. This can remove administrative access; group membership may still grant access. The underlying directory account is not deleted.</p>}
      {action.kind === 'reset-mfa' && <p>Reset this user’s MFA registration. VBR will require MFA setup again at their next sign-in.</p>}
      {action.kind === 'service' && <p>{action.enabled ? 'Service account mode automatically disables MFA for this account. Confirm that this account is intended for an integration or service.' : 'Remove the service-account exemption. Review the server’s MFA policy and the integration’s sign-in requirements.'}</p>}
      {action.kind === 'mfa' && <p>{action.enabled ? 'Require MFA for users on this VBR server. Integrations using passwords may stop working unless their accounts are marked as service accounts.' : 'Disable MFA enforcement for users on this VBR server. This reduces sign-in protection.'}</p>}
    </fieldset>
    <p className={styles.hint}>VBR enforces your permissions and any four-eyes authorization requirements. No change is applied until you confirm.</p>
    <DialogFooter><Button variant="outline" disabled={pending} onClick={onClose}>Cancel</Button>{error ? <Button onClick={() => onSaved(false)}>Refresh identity</Button> : <Button variant={action.kind === 'delete' ? 'destructive' : 'default'} disabled={pending || !valid} onClick={submit}>{pending && <Loader2 size={14} className="animate-spin" />}{action.kind === 'add' ? 'Confirm add' : action.kind === 'roles' ? 'Save role changes' : 'Confirm change'}</Button>}</DialogFooter>
  </DialogContent></Dialog>
}
