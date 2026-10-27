'use client'
import { useState,type FormEvent } from 'react'
import { FileText,Loader2,Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from '@/components/ui/dialog'
import { veeamApi } from '@/lib/api/veeam-client'
import { platforms,type Platform,type Consumer } from '@/lib/licensing/model'
import shared from '@/components/vbm-dashboard/vbm-dashboard.module.css'
import styles from './licensing.module.css'

function download(blob:Blob,name:string) {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
export function ReportAction({platform,disabled}:{platform:Platform;disabled?:boolean}) {
  const [pending,setPending]=useState(false),[open,setOpen]=useState(false),[error,setError]=useState<string|null>(null)
  const today=new Date().toISOString().slice(0,10)
  async function generate(start?:string,end?:string) {
    if(pending)return
    setPending(true);setError(null)
    try {if(platform==='vbr'){const html=await veeamApi.createLicenseReport();download(new Blob([html],{type:'text/html;charset=utf-8'}),`Veeam_VBR_License_Report_${today}.html`)}
      else {const from=new Date(`${start}T00:00:00Z`),to=new Date(Math.min(Date.now(),new Date(`${end}T23:59:59.999Z`).getTime()));if(!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from>=to)throw Error('Choose a valid report date range.');download(await veeamApi.generateVB365LicenseReport(from.toISOString(),to.toISOString()),`Veeam_M365_License_Report_${today}.pdf`)}
      toast.success('License report downloaded');setOpen(false)
    }catch(error){const message=error instanceof Error ? error.message:'Report generation failed';setError(message);toast.error(message)}finally{setPending(false)}
  }
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const values=new FormData(event.currentTarget);void generate(String(values.get('start')),String(values.get('end')))}
  return <><Button size="sm" variant="outline" disabled={pending || disabled} onClick={()=>platform==='vbr' ? void generate():setOpen(true)} aria-label={`Generate ${platform==='vbr' ? 'VBR':'Microsoft 365'} license report`}>{pending ? <Loader2 size={14} className="animate-spin"/>:<FileText size={14}/>}Generate Report</Button><Dialog open={open} onOpenChange={value=>{if(!pending){setOpen(value);setError(null)}}}><DialogContent><DialogHeader><DialogTitle>Microsoft 365 license report</DialogTitle><DialogDescription>Download the license overview as a PDF for the selected dates. Report dates use UTC.</DialogDescription></DialogHeader><form className={styles.form} onSubmit={submit}><label>Start date<Input type="date" name="start" defaultValue={`${today.slice(0,7)}-01`} max={today} required disabled={pending}/></label><label>End date<Input type="date" name="end" defaultValue={today} max={today} required disabled={pending}/></label>{error && <p role="alert">{error}</p>}<div className={shared.actions}><Button type="button" variant="outline" disabled={pending} onClick={()=>setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? 'Generating…':'Download PDF'}</Button></div></form></DialogContent></Dialog></>
}
export function RevokeDialog({row,sourceName,onClose,onRefresh}:{row:Consumer|null;sourceName?:string;onClose:()=>void;onRefresh:()=>void}) {
  const [pending,setPending]=useState(false),[error,setError]=useState<string|null>(null)
  async function revoke() {
    if(!row?.revoke || pending)return
    setPending(true);setError(null)
    try {if(row.revoke==='user')await veeamApi.revokeVB365License(row.id);else if(row.revoke==='capacity')await veeamApi.revokeLicenseCapacity(row.id);else if(row.revoke==='sockets')await veeamApi.revokeLicenseSocket(row.id);else await veeamApi.revokeLicenseInstance(row.id)
      toast.success(`License revocation accepted for ${row.name}`);onRefresh();onClose()
    }catch(error){setError(error instanceof Error ? error.message:'License revocation failed')}finally{setPending(false)}
  }
  return <Dialog open={!!row} onOpenChange={open=>{if(!open && !pending){setError(null);onClose()}}}><DialogContent><DialogHeader><DialogTitle>Revoke License</DialogTitle><DialogDescription>Revoke the license for <strong>{row?.name}</strong> on {row ? platforms[row.platform]:''}{sourceName ? ` · ${sourceName}`:''}? {row?.platform==='vbm' ? 'The API cannot revoke a user license while a backup repository contains that user’s data. Older backups do not establish revocation eligibility.':'This action may affect backup jobs associated with this workload.'}</DialogDescription></DialogHeader>{error && <p role="alert" className={styles.error}>{error}</p>}<div className={shared.actions}><Button variant="outline" disabled={pending} onClick={()=>{setError(null);onClose()}}>Cancel</Button><Button variant="destructive" disabled={pending || !row?.revoke} onClick={revoke}>{pending ? <Loader2 size={14} className="animate-spin"/>:<Trash2 size={14}/>}Revoke License</Button></div></DialogContent></Dialog>
}
