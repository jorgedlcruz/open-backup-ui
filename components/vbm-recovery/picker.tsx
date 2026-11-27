'use client'
// Open Backup UI v1.3.0
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Cloud, Globe, Mail, Search, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataLoading } from '@/components/ui/data-loading'
import { BackupReadWait } from './backup-read-wait'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useI18n } from '@/components/providers/i18n-provider'
import { content, copyKind, name, objectKey, lookup, type Detail, type ObjectType, type Point, type Row } from '@/lib/vbm-protected/model'
import type { RecoveryCandidates } from '@/lib/vbm-recovery/candidates'
import { workloads, type RecoverySession, type Workload } from '@/lib/vbm-recovery/model'
import { openBrowseSession, RecoveryRequestError } from './client'
import { browseProxyWaitMs } from '@/lib/vbm-recovery/proxy-wait-policy'
import css from './center.module.css'

export const recoveryGoals = {
  Exchange: { title:'Email and calendars', subtitle:'Exchange mailboxes, messages and folders', icon:Mail },
  OneDrive: { title:'Personal files', subtitle:'OneDrive files, folders and versions', icon:Cloud },
  SharePoint: { title:'Sites and documents', subtitle:'SharePoint libraries, lists and items', icon:Globe },
  Teams: { title:'Team collaboration', subtitle:'Teams channels, files and tabs', icon:Users },
} as const
export type RecoveryEntry = {workload?:Workload;objectId?:string;type?:ObjectType;pointId?:string}
const dayKey=(date:Date)=>`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
const pointDate=(point:Point)=>new Date(point.backupTime||'')
function eligible(row:Row,workload:Workload) {
  if(row.summary.content.includes(workload))return true
  if(row.summary.complete)return false
  return workload==='Exchange'?!!row.mailboxes?.length:workload==='OneDrive'?!!row.oneDrives?.length:workload==='SharePoint'?row.type==='Site'||!!row.sites?.length:row.type==='Team'
}
async function detailFor(row:Pick<Row,'type'|'id'>,signal:AbortSignal):Promise<Detail> {
  const response=await fetch(`/api/vbm/protected-operations?${new URLSearchParams({type:row.type,id:row.id})}`,{signal,cache:'no-store'})
  const data=await response.json()
  if(!response.ok)throw new Error(data.error||'Restore points could not be loaded.')
  return data
}

export function RecoveryPicker({entry,inventory,inventoryLoading,inventoryError,onLoadInventory,onClose,onPreparing}: {
  entry:RecoveryEntry;inventory?:RecoveryCandidates;inventoryLoading:boolean;inventoryError:string;
  onLoadInventory:()=>void;onClose:()=>void;onPreparing:(value:boolean)=>void
}) {
  const {t,formatDate}=useI18n(),router=useRouter()
  const [workload,setWorkload]=useState<Workload|undefined>(entry.workload),[query,setQuery]=useState(''),[typeFilter,setTypeFilter]=useState('all')
  const [selected,setSelected]=useState<Pick<Row,'id'|'type'>|null>(entry.objectId&&entry.type?{id:entry.objectId,type:entry.type}:null)
  const [detail,setDetail]=useState<Detail>(),[busyDetail,setBusyDetail]=useState(false),[detailError,setDetailError]=useState(''),[point,setPoint]=useState<Point>()
  const [anchor,setAnchor]=useState(new Date()),[day,setDay]=useState(''),[showDeleted,setShowDeleted]=useState(false),[showAllVersions,setShowAllVersions]=useState(false)
  const [starting,setStarting]=useState<'waiting'|'opening'>(),[startError,setStartError]=useState(''),[uncertain,setUncertain]=useState(false),[revision,setRevision]=useState(0)
  const initialPoint=useRef(entry.pointId),initialSelection=useRef(true),submitted=useRef(false)
  const [waitingForProxy,setWaitingForProxy]=useState(false)
  const detailCache=useRef(new Map<string,Detail>())
  const browseMonitor=useRef<AbortController|null>(null)
  useEffect(()=>()=>browseMonitor.current?.abort(),[])
  useEffect(()=>{if(workload)onLoadInventory()},[workload,onLoadInventory])
  useEffect(()=>{
    if(!selected||!workload)return
    const controller=new AbortController(),key=JSON.stringify([selected.type,selected.id])
    setBusyDetail(true);setDetailError('');setPoint(undefined);setDetail(undefined)
    const read=revision===0&&detailCache.current.has(key)?Promise.resolve(detailCache.current.get(key)!):detailFor(selected,controller.signal)
    read.then(value=>{
      if(controller.signal.aborted)return
      detailCache.current.set(key,value);setDetail(value)
      const points=value.points.data.filter(p=>p.isDeleted===false&&content(p).includes(workload)&&Number.isFinite(pointDate(p).getTime())&&pointDate(p).getTime()<=Date.now()).sort((a,b)=>pointDate(b).getTime()-pointDate(a).getTime())
      const chosen=(initialSelection.current&&initialPoint.current?points.find(p=>p.id===initialPoint.current):undefined)||points[0]
      initialSelection.current=false
      if(chosen){setPoint(chosen);setAnchor(pointDate(chosen));setDay(dayKey(pointDate(chosen)))}
    }).catch(e=>{if(!controller.signal.aborted)setDetailError(e.message)}).finally(()=>{if(!controller.signal.aborted)setBusyDetail(false)})
    return()=>controller.abort()
  },[selected,workload,revision])
  const points=useMemo(()=>detail?.points.data.filter(p=>p.isDeleted===false&&workload&&content(p).includes(workload)&&Number.isFinite(pointDate(p).getTime())&&pointDate(p).getTime()<=Date.now()).sort((a,b)=>pointDate(b).getTime()-pointDate(a).getTime())||[],[detail,workload])
  const byDay=useMemo(()=>{const map=new Map<string,Point[]>();for(const p of points){const key=dayKey(pointDate(p));map.set(key,[...(map.get(key)||[]),p])}return map},[points])
  const candidates=inventory?.objects.data.filter(row=>workload&&eligible(row,workload)&&(typeFilter==='all'||row.type===typeFilter)&&[name(row),row.url,...(row.mailboxes||[]).map(c=>c.email)].filter(Boolean).join(' ').toLowerCase().includes(query.trim().toLowerCase()))||[]
  const years=[...new Set([...points.map(p=>pointDate(p).getFullYear()),anchor.getFullYear()])].sort((a,b)=>b-a)
  const days=Array.from({length:new Date(anchor.getFullYear(),anchor.getMonth()+1,0).getDate()},(_,index)=>new Date(anchor.getFullYear(),anchor.getMonth(),index+1))
  const dateLabel=point?formatDate(point.backupTime!,{dateStyle:'medium',timeStyle:'short'}):''
  const select=(row:Row)=>{initialSelection.current=false;setSelected({id:row.id,type:row.type});setStartError('')}
  const start=async()=>{
    if(submitted.current||!point||!selected||!workload||!detail?.object)return
    submitted.current=true;setStarting('waiting');setWaitingForProxy(false);setStartError('');onPreparing(true)
    const requestId=crypto.randomUUID(),monitor=new AbortController()
    browseMonitor.current=monitor
    try {
      const result=await openBrowseSession<{session:RecoverySession}>({action:'start',requestId,workload,objectType:selected.type,objectId:selected.id,restorePointId:point.id,showDeleted,showAllVersions},monitor.signal,setWaitingForProxy)
      if(monitor.signal.aborted)return
      setStarting('opening')
      router.push(`/vbm/recovery-center/${encodeURIComponent(result.session.id)}`)
    } catch(error) {
      if(monitor.signal.aborted)return
      const known=error instanceof RecoveryRequestError&&!error.outcomeUnknown
      setStartError((error as Error).message);setUncertain(!known);setStarting(undefined)
      if(known){submitted.current=false;onPreparing(false)}
    }
  }
  if(starting||uncertain)return <section className={css.preparing} aria-label={t('Preparing recovery')}><div style={{width:'100%',minWidth:0}}><p className={css.muted} style={{marginBottom:12}}>{detail?.object?name(detail.object):''} · {workload} · {dateLabel}</p>{starting==='waiting'?<BackupReadWait label={waitingForProxy ? t('Waiting for the backup proxy') : t('Waiting for Veeam to open this restore point')} limitMinutes={browseProxyWaitMs/60_000}/>:starting==='opening'?<strong role="status">{t('Opening recovery workspace…')}</strong>:<><strong>{t('Browse session needs checking')}</strong><p className={css.notice} role="alert">{startError}</p><Button variant="outline" onClick={()=>{onPreparing(false);onClose()}}>{t('Check recovery sessions')}</Button></>}</div></section>
  return <Dialog open onOpenChange={open=>{if(!open)onClose()}}><DialogContent className={css.dialog}><DialogHeader><DialogTitle>{workload?`${workload} · ${t('Choose a backup')}`:t('What do you want to recover?')}</DialogTitle><DialogDescription>{t(workload?'Choose an object and restore point. The latest available point is selected for you.':'Start with what you need back. Explore and restore it in one workspace.')}</DialogDescription></DialogHeader>
    {!workload?<div className={css.pickerGoals}>{workloads.map(value=>{const goal=recoveryGoals[value];return <button key={value} className={css.goal} onClick={()=>setWorkload(value)}><span className={css.goalIcon}><goal.icon size={28}/></span><span><strong>{t(goal.title)}</strong><small>{t(goal.subtitle)}</small></span><ArrowRight size={17}/></button>})}</div>:<>
      <div className={css.selection}><section className={css.objects}><div className={css.labelRow}><h3 className={css.sectionTitle}>{t('Protected objects')}</h3><select aria-label={t('Object type')} value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option value="all">{t('All types')}</option>{['User','Group','Site','Team'].map(value=><option key={value}>{value}</option>)}</select></div><label className={css.search}><Search size={15}/><input value={query} type="search" aria-label={t('Search protected objects')} placeholder={t('Search names, email or URL')} onChange={e=>setQuery(e.target.value)}/></label>
        {inventoryError&&<div className={css.error}>{inventoryError}<Button variant="ghost" size="sm" onClick={onLoadInventory}>{t('Retry')}</Button></div>}
        {!!inventory?.warnings.length&&<p className={css.notice}>{t('Some protected objects could not be loaded. Refresh to check their availability again.')}</p>}
        {inventoryLoading&&!inventory?<div className={css.empty}><DataLoading status={t('Loading protected objects…')} compact/></div>:<div className={css.objectList}>{candidates.map(row=><button className={css.object} key={objectKey(row)} aria-pressed={selected?.id===row.id&&selected.type===row.type} onClick={()=>select(row)}><span><strong>{name(row)}</strong><small>{row.type} · {row.url||row.mailboxes?.[0]?.email||row.organizationId}</small>{!row.summary.content.includes(workload)&&<small>{t('Check available restore points')}</small>}</span>{selected?.id===row.id&&selected.type===row.type&&<Check size={15}/>}</button>)}{!candidates.length&&!inventoryError&&<div className={css.empty}>{t('No protected objects match this recovery type and search.')}</div>}</div>}
      </section><section className={css.pointArea}><h3 className={css.sectionTitle}><CalendarDays size={16}/>{t('Restore point')}{detail?.object&&<span className={css.muted}>· {name(detail.object)}</span>}</h3>
        {!selected?<div className={css.empty}><CalendarDays size={36}/><strong>{t('Choose a protected object')}</strong><span>{t('Its available restore points will appear here.')}</span></div>:busyDetail?<div className={css.empty}><DataLoading status={t('Loading restore points…')} compact/></div>:detailError?<div className={css.error}>{detailError}<Button variant="ghost" onClick={()=>setRevision(v=>v+1)}>{t('Retry')}</Button></div>:!points.length?<div className={css.empty}>{t('No retained restore points for this workload were found.')}</div>:<div className={css.calendar}><div className={css.calendarMain}><div className={css.calendarBar}><button aria-label={t('Previous month')} onClick={()=>setAnchor(new Date(anchor.getFullYear(),anchor.getMonth()-1,1))}><ChevronLeft size={16}/></button><select aria-label={t('Month')} value={anchor.getMonth()} onChange={e=>setAnchor(new Date(anchor.getFullYear(),Number(e.target.value),1))}>{Array.from({length:12},(_,month)=><option value={month} key={month}>{formatDate(new Date(2020,month,1),{month:'long'})}</option>)}</select><select aria-label={t('Year')} value={anchor.getFullYear()} onChange={e=>setAnchor(new Date(Number(e.target.value),anchor.getMonth(),1))}>{years.map(year=><option key={year}>{year}</option>)}</select><button aria-label={t('Next month')} onClick={()=>setAnchor(new Date(anchor.getFullYear(),anchor.getMonth()+1,1))}><ChevronRight size={16}/></button></div><div className={css.calendarGrid}>{Array.from({length:7},(_,i)=><span key={`week${i}`}>{formatDate(new Date(2020,10,1+i),{weekday:'narrow'})}</span>)}{Array.from({length:days[0].getDay()},(_,i)=><span key={`blank${i}`}/>)}{days.map(date=>{const key=dayKey(date),available=byDay.get(key);return <button key={key} className={css.day} disabled={!available?.length} aria-pressed={day===key} aria-label={`${formatDate(date,{dateStyle:'long'})}${available?` · ${available.length} ${t('restore points')}`:''}`} onClick={()=>{setDay(key);setPoint(available![0])}}>{date.getDate()}{available&&<i/>}</button>})}</div></div><div className={css.times}><strong className={css.row}><Clock size={14}/>{t('Restore times')}</strong><span className={css.muted}>{byDay.get(day)?.[0]?formatDate(byDay.get(day)![0].backupTime!,{dateStyle:'medium'}):''}</span>{(byDay.get(day)||[]).map(value=><button key={value.id} className={css.time} aria-pressed={value.id===point?.id} onClick={()=>setPoint(value)}><strong>{formatDate(value.backupTime!,{timeStyle:'medium'})}</strong><small>{t(copyKind(value))} · {lookup(detail?.repositories.data||[],value.repositoryId)}</small></button>)}</div></div>}
        {detail&&!detail.points.complete&&<p className={css.notice}>{t('Some restore-point history is unavailable. The calendar shows the points currently loaded.')}</p>}
        {point&&<div className={css.options}><label><input type="checkbox" checked={showDeleted} onChange={e=>setShowDeleted(e.target.checked)}/>{t('Include deleted items')}</label><label><input type="checkbox" checked={showAllVersions} onChange={e=>setShowAllVersions(e.target.checked)}/>{t('Include all versions')}</label></div>}
      </section></div>
      {startError&&<p className={css.error} role="alert">{startError}</p>}
      <div className={css.pickerFooter}><Button variant="outline" size="sm" onClick={()=>{setWorkload(undefined);setSelected(null);setDetail(undefined);setPoint(undefined);setStartError('')}}><ArrowLeft size={14}/>{t('Recovery goal')}</Button><span>{dateLabel}</span><Button disabled={!point||!detail?.object||busyDetail} onClick={start}>{t('Open backup')}<ArrowRight size={15}/></Button></div>
    </>}
  </DialogContent></Dialog>
}
