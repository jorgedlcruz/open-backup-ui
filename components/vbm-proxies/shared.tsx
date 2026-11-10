'use client'
// Open Backup UI v1.2.0

import { useVbmPresentation } from '@/components/vbm-jobs/presentation'
import { Trans } from "@/components/providers/i18n-provider"
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
export function EvidenceNotices({data,error,loading}:{data:Snapshot;error:string|null;loading:boolean}) {
  const {t,formatNumber,diagnostic}=useVbmPresentation()


return <>{error && <Notice error>{diagnostic(error)}<Trans>{" Showing the previous snapshot."}</Trans></Notice>}{loading && <p className={shared.refreshing} role="status"><Trans>{"Refreshing · previous proxy evidence remains visible."}</Trans></p>}{!!data.warnings.length && <details className={ops.warnings}><summary>{t("{count} data coverage notices",{count:formatNumber(data.warnings.length)})}</summary><ul>{data.warnings.map((warning,index)=><li key={index}>{diagnostic(warning)}</li>)}</ul></details>}</>}
export function Availability({row}:{row:Row}) {
  const {t,localLabel}=useVbmPresentation()



return <><span className={cn(ops.badge,row.state.online ? ops.success:row.state.offline ? ops.danger:ops.neutral)}>{localLabel(row.proxy.status || t("Not reported"))}</span><p className={cn(shared.sub,row.state.maintenance && ops.warning)}><Trans>{"Maintenance: "}</Trans>{localLabel(row.proxy.maintenanceModeState || t("Unknown"))}</p></>}
export function Component({row}:{row:Row}) {
  const {t,localLabel}=useVbmPresentation()



return <><strong>{row.proxy.version || t("Version not reported")}</strong><p className={cn(shared.sub,row.update.review ? ops.warning:row.update.state==='unknown' ? ops.neutral:ops.success)}>{localLabel(row.update.label)}</p><p className={shared.sub}>{localLabel(row.update.detail)}</p></>}
export function Resource({value,label}:{value:number|null;label:string}) {
  const {t,formatNumber}=useVbmPresentation()
return <div className={styles.resource}>{value!==null ? <><strong>{formatNumber(value/100,{style:"percent",maximumFractionDigits:1})}</strong><div className={ops.capacityBar} role="meter" aria-label={t(label)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><span className={value>=90 ? ops.dangerBar:value>=80 ? ops.warningBar:ops.successBar} style={{width:`${value}%`}}/></div></>:<span className={ops.neutral}><Trans>{"Not reported"}</Trans></span>}</div>}
export function Roles({proxy}:{proxy:Proxy}) {
  const {localLabel}=useVbmPresentation()


return <div className={styles.roles}>{proxy.role?.length ? [...new Set(proxy.role)].map(role=><span key={role} className={cn(ops.badge,ops.neutral)}>{localLabel(role)}</span>):<span className={ops.neutral}><Trans>{"Not reported"}</Trans></span>}</div>}
export function ProxyActions({proxy,onRefresh}:{proxy:Proxy;onRefresh:()=>void}) {
  const {t,diagnostic}=useVbmPresentation()



  const [pending,setPending]=useState(false),[maintenance,setMaintenance]=useState<boolean|null>(null),[os,setOs]=useState(normalized(proxy.operatingSystem)==='linux' ? 'Linux':'Windows')
  const state=normalized(proxy.maintenanceModeState),transition=['enabling','disabling'].includes(state)
  async function run(enable?:boolean,credentials?:ProxyCredentials) {
    if(pending)return
    setPending(true)
    try {if(enable===undefined)await veeamApi.rescanVB365Proxy(proxy.id);else await veeamApi.setVB365ProxyMaintenanceMode(proxy.id,enable,credentials)
      toast.success(enable===undefined?t('Rescan request accepted for {name}',{name:proxy.hostName || proxy.id}):enable?t('Enable maintenance request accepted for {name}',{name:proxy.hostName || proxy.id}):t('Disable maintenance request accepted for {name}',{name:proxy.hostName || proxy.id}));setMaintenance(null);onRefresh()
    }catch(error){toast.error(error instanceof Error ? diagnostic(error.message):t('Proxy action failed'))}finally{setPending(false)}
  }
  function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=event.currentTarget,data=new FormData(form)
    const credentials:ProxyCredentials=os==='Linux' ? {sshSettings:{account:String(data.get('username')),accountPassword:String(data.get('password')),port:Number(data.get('port')),fingerprint:String(data.get('fingerprint')),elevateAccountToRoot:data.get('elevate')==='on'}}:{username:String(data.get('username')),password:String(data.get('password'))}
    form.reset();void run(maintenance===true,credentials)
  }
  return <><DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline" disabled={pending} aria-label={t("Actions for {name}", {name: proxy.hostName || proxy.id})}><MoreHorizontal size={14}/>{pending ? t("Working…"):t("Actions")}</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={()=>run()}><RefreshCw size={14}/><Trans>{"Rescan"}</Trans></DropdownMenuItem><DropdownMenuItem disabled={transition} onSelect={()=>setMaintenance(state!=='enabled')}>{state==='enabled' ? <Play size={14}/>:<Wrench size={14}/ >}{state==='enabled' ? t("Disable Maintenance"):t("Enable Maintenance")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    <Dialog open={maintenance!==null} onOpenChange={open=>{if(!open && !pending)setMaintenance(null)}}><DialogContent><DialogHeader><DialogTitle>{maintenance?t("Enable maintenance · {name}",{name:proxy.hostName || proxy.id}):t("Disable maintenance · {name}",{name:proxy.hostName || proxy.id})}</DialogTitle><DialogDescription><Trans>{"The API requires host credentials for this action. Enter them for this request; they are not saved. "}</Trans>{maintenance ? t("Maintenance makes this proxy unavailable for new work."):t("The proxy will leave maintenance mode.")}</DialogDescription></DialogHeader><form className={styles.form} onSubmit={submit}>
      <label><Trans>{"Operating system"}</Trans><select aria-label={t("Maintenance operating system")} value={os} disabled={pending} onChange={event=>setOs(event.target.value)}><option value={"Windows"}><Trans>{"Windows"}</Trans></option><option value={"Linux"}><Trans>{"Linux"}</Trans></option></select></label>
      <label>{os==='Linux' ? t("SSH account"):t("Windows username")}<Input name="username" autoComplete="off" required maxLength={4096} disabled={pending}/></label><label><Trans>{"Password"}</Trans><Input type="password" name="password" autoComplete="new-password" required maxLength={4096} disabled={pending}/></label>
      {os==='Linux' && <><label><Trans>{"SSH port"}</Trans><Input name="port" type="number" min={1} max={65535} defaultValue={22} required disabled={pending}/></label><label><Trans>{"Verified SSH fingerprint"}</Trans><Input name="fingerprint" autoComplete="off" required maxLength={4096} disabled={pending}/></label><label className={styles.check}><input name="elevate" type="checkbox" disabled={pending}/><Trans>{"Elevate account with sudo"}</Trans></label></>}
      <div className={shared.actions}><Button type="button" variant="outline" disabled={pending} onClick={()=>setMaintenance(null)}><Trans>{"Cancel"}</Trans></Button><Button type="submit" disabled={pending}>{pending ? t("Submitting…"):maintenance ? t("Enable Maintenance"):t("Disable Maintenance")}</Button></div>
    </form></DialogContent></Dialog>
  </>
}
