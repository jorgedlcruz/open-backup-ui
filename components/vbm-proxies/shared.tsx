'use client'
import { useState,type FormEvent } from 'react'
import { MoreHorizontal,RefreshCw,Wrench,Play } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/components/ui/dialog'
import { DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Notice } from '@/components/investigation/shared'
import { veeamApi } from '@/lib/api/veeam-client'
import { normalized,type Row,type Snapshot,type Proxy } from '@/lib/vbm-proxies/model'
import { type ProxyCredentials } from '@/lib/vbm-proxies/actions'
import { cn } from '@/lib/utils'
import ops from '@/components/operations/operations.module.css'
import shared from '@/components/vbm-dashboard/vbm-dashboard.module.css'
import styles from './proxies.module.css'
export { useOrganizationRefresh as useProxyRefresh } from '@/components/vbm-organizations/shared'
export { Refresh } from '@/components/vbm-repositories/shared'
export function EvidenceNotices({data,error,loading}:{data:Snapshot;error:string|null;loading:boolean}) {return <>{error && <Notice error>{error} Showing the previous snapshot.</Notice>}{loading && <p className={shared.refreshing} role="status">Refreshing · previous proxy evidence remains visible.</p>}{!!data.warnings.length && <details className={ops.warnings}><summary>{data.warnings.length} data coverage notices</summary><ul>{data.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></details>}</>}
export function Availability({row}:{row:Row}) {return <><span className={cn(ops.badge,row.state.online ? ops.success:row.state.offline ? ops.danger:ops.neutral)}>{row.proxy.status || 'Not reported'}</span><p className={cn(shared.sub,row.state.maintenance && ops.warning)}>Maintenance: {row.proxy.maintenanceModeState || 'Unknown'}</p></>}
export function Component({row}:{row:Row}) {return <><strong>{row.proxy.version || 'Version not reported'}</strong><p className={cn(shared.sub,row.update.review ? ops.warning:row.update.state==='unknown' ? ops.neutral:ops.success)}>{row.update.label}</p><p className={shared.sub}>{row.update.detail}</p></>}
export function Resource({value,label}:{value:number|null;label:string}) {return <div className={styles.resource}>{value!==null ? <><strong>{value.toFixed(1)}%</strong><div className={ops.capacityBar} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><span className={value>=90 ? ops.dangerBar:value>=80 ? ops.warningBar:ops.successBar} style={{width:`${value}%`}}/></div></>:<span className={ops.neutral}>Not reported</span>}</div>}
export function Roles({proxy}:{proxy:Proxy}) {return <div className={styles.roles}>{proxy.role?.length ? [...new Set(proxy.role)].map(role=><span key={role} className={cn(ops.badge,ops.neutral)}>{role}</span>):<span className={ops.neutral}>Not reported</span>}</div>}
export function ProxyActions({proxy,onRefresh}:{proxy:Proxy;onRefresh:()=>void}) {
  const [pending,setPending]=useState(false),[maintenance,setMaintenance]=useState<boolean|null>(null),[os,setOs]=useState(normalized(proxy.operatingSystem)==='linux' ? 'Linux':'Windows')
  const state=normalized(proxy.maintenanceModeState),transition=['enabling','disabling'].includes(state)
  async function run(enable?:boolean,credentials?:ProxyCredentials) {
    if(pending)return
    setPending(true)
    try {if(enable===undefined)await veeamApi.rescanVB365Proxy(proxy.id);else await veeamApi.setVB365ProxyMaintenanceMode(proxy.id,enable,credentials)
      toast.success(`${enable===undefined ? 'Rescan':enable ? 'Enable maintenance':'Disable maintenance'} request accepted for ${proxy.hostName || proxy.id}`);setMaintenance(null);onRefresh()
    }catch(error){toast.error(error instanceof Error ? error.message:'Proxy action failed')}finally{setPending(false)}
  }
  function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=event.currentTarget,data=new FormData(form)
    const credentials:ProxyCredentials=os==='Linux' ? {sshSettings:{account:String(data.get('username')),accountPassword:String(data.get('password')),port:Number(data.get('port')),fingerprint:String(data.get('fingerprint')),elevateAccountToRoot:data.get('elevate')==='on'}}:{username:String(data.get('username')),password:String(data.get('password'))}
    form.reset();void run(maintenance===true,credentials)
  }
  return <><DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline" disabled={pending} aria-label={`Actions for ${proxy.hostName || proxy.id}`}><MoreHorizontal size={14}/>{pending ? 'Working…':'Actions'}</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={()=>run()}><RefreshCw size={14}/>Rescan</DropdownMenuItem><DropdownMenuItem disabled={transition} onSelect={()=>setMaintenance(state!=='enabled')}>{state==='enabled' ? <Play size={14}/>:<Wrench size={14}/ >}{state==='enabled' ? 'Disable Maintenance':'Enable Maintenance'}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    <Dialog open={maintenance!==null} onOpenChange={open=>{if(!open && !pending)setMaintenance(null)}}><DialogContent><DialogHeader><DialogTitle>{maintenance ? 'Enable':'Disable'} maintenance · {proxy.hostName || proxy.id}</DialogTitle><DialogDescription>The API requires host credentials for this action. Enter them for this request; they are not saved. {maintenance ? 'Maintenance makes this proxy unavailable for new work.':'The proxy will leave maintenance mode.'}</DialogDescription></DialogHeader><form className={styles.form} onSubmit={submit}>
      <label>Operating system<select aria-label="Maintenance operating system" value={os} disabled={pending} onChange={event=>setOs(event.target.value)}><option>Windows</option><option>Linux</option></select></label>
      <label>{os==='Linux' ? 'SSH account':'Windows username'}<Input name="username" autoComplete="off" required maxLength={4096} disabled={pending}/></label><label>Password<Input type="password" name="password" autoComplete="new-password" required maxLength={4096} disabled={pending}/></label>
      {os==='Linux' && <><label>SSH port<Input name="port" type="number" min={1} max={65535} defaultValue={22} required disabled={pending}/></label><label>Verified SSH fingerprint<Input name="fingerprint" autoComplete="off" required maxLength={4096} disabled={pending}/></label><label className={styles.check}><input name="elevate" type="checkbox" disabled={pending}/>Elevate account with sudo</label></>}
      <div className={shared.actions}><Button type="button" variant="outline" disabled={pending} onClick={()=>setMaintenance(null)}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? 'Submitting…':maintenance ? 'Enable Maintenance':'Disable Maintenance'}</Button></div>
    </form></DialogContent></Dialog>
  </>
}
