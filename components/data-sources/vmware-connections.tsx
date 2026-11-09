'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Monitor, ShieldCheck } from 'lucide-react'
import { useI18n } from '@/components/providers/i18n-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { applicationRequest } from '@/lib/api/application-request'
import type { SavedVmwareManager, VmwareManager } from '@/lib/server/vmware-console-connections'
import ops from '@/components/operations/operations.module.css'
import styles from './sources.module.css'

type Inventory = {sourceKey:string; sourceName:string; managers:VmwareManager[]; connections:SavedVmwareManager[]; complete:boolean}
type Selection = {manager:VmwareManager; saved?:SavedVmwareManager; action:'save'|'remove'}
const endpoint = '/api/administration/vmware-consoles'
const authority = (m: VmwareManager) => (m.hostname.includes(':') ? '[' + m.hostname + ']' : m.hostname) + ':' + m.port
const matches = (a: VmwareManager, b: VmwareManager) => a.hostname === b.hostname && a.port === b.port && a.id === b.id

export function VmwareConnections({enabled}: {enabled:boolean}) {
  const {t} = useI18n()
  const [open,setOpen] = useState(false)
  return <section id="vmware-console-connections" className={ops.panel} aria-label={t('VMware console connections')}>
    <div className={ops.panelHeading}><div><h2>{t('VMware console connections')}</h2><p>{enabled
      ? t('Connect vCenter or ESXi to open consoles for recovered VMs.')
      : t('Set HTTPS_ADMIN_TOKEN on the application server to manage VMware connections.')}</p></div>
      {enabled && <Button size="sm" variant="outline" onClick={()=>setOpen(true)}><Monitor size={15}/>{t('Configuration')}</Button>}
    </div>
    <Dialog open={open} onOpenChange={setOpen}>{open && <VmwareEditor/>}</Dialog>
  </section>
}

function VmwareEditor() {
  const {t} = useI18n()
  const [token,setToken] = useState('')
  const [inventory,setInventory] = useState<Inventory>()
  const [selection,setSelection] = useState<Selection>()
  const [username,setUsername] = useState(''), [password,setPassword] = useState('')
  const [trust,setTrust] = useState('system'), [caPem,setCaPem] = useState('')
  const [error,setError] = useState(''), [success,setSuccess] = useState('')
  const [busy,setBusy] = useState(false), pending = useRef(false)
  const [secure,setSecure] = useState<boolean>()
  useEffect(() => setSecure(window.isSecureContext), [])
  const adminHeaders = {'x-https-admin-token':token}
  function select(next?: Selection) {
    setSelection(next)
    setUsername(next?.saved?.username || '')
    setPassword(''); setCaPem(''); setTrust(next?.saved ? 'keep' : 'system'); setSuccess(''); setError('')
  }
  async function perform(work: () => Promise<void>) {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(''); setSuccess('')
    try { await work() }
    catch (e) { setError(e instanceof Error ? e.message : 'Request failed.') }
    finally { pending.current = false; setBusy(false) }
  }
  async function load() {
    if (!window.isSecureContext) throw new Error('Use HTTPS or a loopback address to manage VMware connections.')
    const current = await applicationRequest<Inventory>(endpoint,{headers:adminHeaders})
    setInventory(current)
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!inventory || !selection) return
    const {manager,saved,action} = selection
    await perform(async () => {
      const body = {action, ...manager, sourceKey:inventory.sourceKey, revision:saved?.revision ?? null,
        ...(action === 'save' ? {username,password,trust,...(trust === 'custom' ? {caPem} : {})} : {})}
      await applicationRequest(endpoint,{method:'POST',headers:{...adminHeaders,'Content-Type':'application/json'},body:JSON.stringify(body)})
      select()
      await load()
      setSuccess(action === 'save' ? 'VMware connection verified and saved.' : 'VMware connection removed.')
    })
  }
  const live = inventory?.managers || [], saved = inventory?.connections || []
  const missing = saved.filter(row => !live.some(manager => matches(manager,row)))
  return <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>{t('VMware console connections')}</DialogTitle><DialogDescription>{inventory?.sourceName || t('Veeam Backup & Replication')}</DialogDescription></DialogHeader>
    {secure === false ? <p role="alert">{t('Use HTTPS or a loopback address to manage VMware connections.')}</p> : !secure ? null : !inventory ? <form className={styles.form} onSubmit={event=>{event.preventDefault(); void perform(load)}}>
      <label>{t('Administration token')}<Input type="password" autoComplete="off" required maxLength={512} value={token} onChange={event=>setToken(event.target.value)} /></label>
      <p className={styles.hint}>{t('Enter the HTTPS_ADMIN_TOKEN configured on this server. It is not saved in your browser.')}</p>
      <Button type="submit" disabled={busy || !token}><ShieldCheck size={15}/>{t('Continue')}</Button>
    </form> : selection ? <form className={styles.form} onSubmit={submit}>
      <strong className={styles.managerName}>{authority(selection.manager)}</strong>
      {selection.action === 'save' ? <>
        <label>{t('Username')}<Input autoComplete="off" maxLength={512} required value={username} onChange={event=>setUsername(event.target.value)} /></label>
        <label>{t('Password')}<Input type="password" autoComplete="new-password" maxLength={4096} required={!selection.saved || username !== selection.saved.username || trust !== 'keep'} value={password} onChange={event=>setPassword(event.target.value)} /></label>
        <label>{t('VMware certificate trust')}<select value={trust} onChange={event=>setTrust(event.target.value)}>
          {selection.saved && <option value="keep">{t('Keep current certificate trust')}</option>}
          <option value="system">{t('System certificate authorities')}</option>
          <option value="custom">{t('Custom CA or self-signed certificate')}</option>
        </select></label>
        {trust === 'custom' && <label>{t('Certificate (PEM)')}<Textarea required maxLength={65536} value={caPem} onChange={event=>setCaPem(event.target.value)} spellCheck={false}/></label>}
      </> : <p>{t('Remove the saved VMware console connection for this manager?')}</p>}
      <div className={styles.toolbar}><Button type="button" variant="outline" disabled={busy} onClick={()=>select()}>{t('Cancel')}</Button>
        <Button type="submit" variant={selection.action === 'remove' ? 'destructive' : 'default'} disabled={busy}>{busy ? t('Loading…') : selection.action === 'remove' ? t('Remove') : t('Verify and save')}</Button></div>
    </form> : <div className={styles.form}>
      {[...live,...missing].map(manager => {
        const record = saved.find(row => matches(row,manager)), available = live.some(row => matches(row,manager))
        return <div className={styles.managerRow} key={manager.id + authority(manager)}><div><strong className={styles.managerName}>{authority(manager)}</strong>
          {record && <p className={styles.hint}>{record.username} · {t(record.customTrust ? 'Custom CA or self-signed certificate' : 'System certificate authorities')}</p>}</div>
          <div className={styles.toolbar}>{available && <Button size="sm" variant="outline" onClick={()=>select({action:'save',manager,saved:record})}>{t(record ? 'Edit' : 'Add')}</Button>}
          {record && <Button size="sm" variant="ghost" onClick={()=>select({action:'remove',manager,saved:record})}>{t('Remove')}</Button>}</div></div>
      })}
      {!live.length && !missing.length && <p>{t('No vCenter or standalone ESXi servers were reported by this VBR source.')}</p>}
      {!inventory.complete && <p>{t('Partial collection')}</p>}
      <Button size="sm" variant="outline" disabled={busy} onClick={()=>void perform(load)}>{t('Refresh')}</Button>
    </div>}
    {error && <p role="alert" className={styles.error}>{t(error)}</p>}
    {success && <p role="status" className={styles.hint}>{t(success)}</p>}
  </DialogContent>
}
