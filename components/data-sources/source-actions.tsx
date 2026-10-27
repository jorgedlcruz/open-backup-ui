'use client'
import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { platforms, endpoint, type Platform, type Row, type Snapshot } from '@/lib/data-sources/model'
import shared from '@/components/vbm-dashboard/vbm-dashboard.module.css'
import styles from './sources.module.css'
import { applicationRequest } from '@/lib/api/application-request'

export type Action={type:'add'} | {type:'edit'|'remove'|'connect'|'disconnect';row:Row}
export async function sourceRequest<T = Snapshot>(path:string,method='GET',body?:unknown,signal?:AbortSignal) {
  return applicationRequest<T>(`/api/administration/data-sources${path}`,{method,signal,...(body!==undefined ? {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})})
}
export function SourceActionDialog({action,onClose,onComplete}:{action:Action;onClose:()=>void;onComplete:()=>void}) {
  const row='row' in action ? action.row:null,router=useRouter()
  const [pending,setPending]=useState(false),[error,setError]=useState<string|null>(null),[type,setType]=useState<Platform>(row?.type || 'vbr'),[port,setPort]=useState('9419'),[saved,setSaved]=useState(!!row?.hasCredentials),[show,setShow]=useState(false)
  const title=action.type==='add' ? 'Add Data Source':action.type==='edit' ? 'Edit Data Source':action.type==='remove' ? 'Remove Data Source':action.type==='disconnect' ? 'Disconnect session':`Connect to ${row?.name}`
  const descriptions={add:'Save a platform endpoint, then connect using your credentials.',edit:'Display names are saved on the server. Changing the URL clears saved credentials and requires a new sign-in.',remove:'Remove only this saved connection and its credentials. Backup infrastructure and data are unaffected.',connect:'Authenticate this endpoint and select it for this browser. Credentials are stored encrypted on the application server.',disconnect:'Disconnect this browser session. The saved source and credentials remain available to server-side integrations.'}
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(pending)return
    setPending(true);setError(null)
    const form=new FormData(event.currentTarget)
    try {
      if(action.type==='add') {
        const host=String(form.get('host') || '').trim(),value=Number(port)
        if(!host || /[\s/@?#]/.test(host) || !Number.isInteger(value) || value<1 || value>65535)throw Error('Enter a hostname or IP address and a port between 1 and 65535.')
        const hostname=host.includes(':') && !host.startsWith('[') ? `[${host}]`:host
        await sourceRequest('','POST',{type,name:String(form.get('name') || ''),url:endpoint(`https://${hostname}:${value}`).url})
      } else if(row) {
        const path=`/${encodeURIComponent(row.id)}`
        if(action.type==='edit')await sourceRequest(path,'PATCH',{name:String(form.get('name') || ''),url:endpoint(String(form.get('url'))).url})
        if(action.type==='remove')await sourceRequest(path,'DELETE')
        if(action.type==='disconnect')await sourceRequest(`${path}/disconnect`,'POST')
        if(action.type==='connect')await sourceRequest(`${path}/connect`,'POST',saved ? {}:{username:String(form.get('username') || ''),password:String(form.get('password') || '')})
      }
      toast.success(action.type==='add' ? 'Data source saved':action.type==='edit' ? 'Data source updated':action.type==='remove' ? 'Data source removed':action.type==='disconnect' ? 'Browser session disconnected':'Data source connected')
      onComplete();onClose();router.refresh()
    }catch(error){setError(error instanceof Error ? error.message:'Action failed.')}finally{setPending(false)}
  }
  return <Dialog open onOpenChange={open=>{if(!open && !pending)onClose()}}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{descriptions[action.type]}</DialogDescription></DialogHeader>
    <form className={styles.form} onSubmit={submit}>
      {row && <div className={styles.target}><strong>{row.name}</strong><span>{platforms[row.type].name}</span><span>{row.url}</span></div>}
      {action.type==='add' && <><label>Platform<select aria-label="Data source platform" value={type} disabled={pending} onChange={event=>{const value=event.target.value as Platform;setType(value);setPort(String(platforms[value].port))}}>{Object.entries(platforms).map(([key,value])=><option key={key} value={key}>{value.name}</option>)}</select></label><div className={styles.address}><label>Server address<Input name="host" placeholder="backup.example.com" autoComplete="off" required disabled={pending}/></label><label>Port<Input aria-label="Server port" type="number" min={1} max={65535} value={port} onChange={event=>setPort(event.target.value)} disabled={pending} required/></label></div><p className={styles.hint}>New connections use HTTPS.</p></>}
      {action.type==='edit' && <label>API URL<Input name="url" defaultValue={row?.url} required disabled={pending}/></label>}
      {(action.type==='edit' || action.type==='add') && <label>Display name<Input name="name" defaultValue={action.type==='edit' ? row?.name:''} maxLength={200} placeholder="Optional friendly name" disabled={pending}/></label>}
      {action.type==='connect' && <>
        {row?.hasCredentials && <label className={styles.checkbox}><input type="checkbox" checked={saved} disabled={pending || row.managed==='environment'} onChange={event=>setSaved(event.target.checked)}/>Use saved credentials</label>}
        {!saved && row?.managed!=='environment' && <><label>Username<Input name="username" defaultValue={row?.username} autoComplete="username" required disabled={pending}/></label><label>Password<div className={styles.password}><Input name="password" type={show ? 'text':'password'} autoComplete="current-password" required disabled={pending}/><Button type="button" variant="ghost" size="icon" aria-label={show ? 'Hide password':'Show password'} onClick={()=>setShow(!show)}>{show ? <EyeOff size={16}/>:<Eye size={16}/>}</Button></div></label></>}
        {row?.managed==='environment' && !row.hasCredentials && <p>Set this source’s username and password in the server environment before connecting.</p>}
      </>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={shared.actions}><Button type="button" variant="outline" disabled={pending} onClick={onClose}>Cancel</Button><Button type="submit" variant={action.type==='remove' ? 'destructive':'default'} disabled={pending || (action.type==='connect' && row?.managed==='environment' && !row.hasCredentials)}>{pending ? 'Working…':action.type==='add' ? 'Add Source':action.type==='edit' ? 'Save Changes':action.type==='remove' ? 'Remove':action.type==='disconnect' ? 'Disconnect':'Connect'}</Button></div>
    </form>
  </DialogContent></Dialog>
}
