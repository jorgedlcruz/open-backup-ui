"use client"
// Open Backup UI v1.0.2

import { useI18n } from '@/components/providers/i18n-provider'
import { useId,type ReactNode } from 'react'
import { CalendarClock,Clock3,Hand } from 'lucide-react'
import { days,type Retention,type Guest,type Schedule } from '@/lib/job-builder/model'
import type { BuilderOptions } from '@/lib/job-builder/load'
import { usePolicyPresentation } from './presentation'
import { credentialTypeLabel } from './diagnostics'
import s from './builder.module.css'

export function Field({label,children,hint}:{label:string;children:ReactNode;hint?:string}) {return <label className={s.field}><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>}
export function Toggle({label,detail,checked,onChange}:{label:string;detail?:string;checked:boolean;onChange:(value:boolean)=>void}) {return <label className={s.toggle}><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/><span><strong>{label}</strong>{detail&&<small>{detail}</small>}</span></label>}
export function DayPicker({value,onChange,label}:{value:Schedule['days'];onChange:(value:Schedule['days'])=>void;label:string}) {const {dayLabel}=usePolicyPresentation();const id=useId();return <div className={s.days} role="group" aria-label={label}>{days.map(d=><button key={`${id}-${d}`} type="button" className={s.day} aria-label={`${label}: ${dayLabel(d)}`} aria-pressed={value.includes(d)} onClick={()=>onChange(value.includes(d)?value.filter(v=>v!==d):days.filter(v=>v===d||value.includes(v)))}>{dayLabel(d,true)}</button>)}</div>}
export function RetentionEditor({value:v,onChange}:{value:Retention;onChange:(value:Retention)=>void}) {
  const { t } = useI18n()
  const set=(patch:Partial<Retention>)=>onChange({...v,...patch})
  return <><div className={s.fields}><Field label={t("Keep backups for")}><input type="number" min={1} max={9999} value={v.quantity} onChange={e=>set({quantity:Number(e.target.value)})}/></Field><Field label={t("Retention unit")}><select value={v.type} onChange={e=>set({type:e.target.value as Retention['type']})}><option value="Days">{t("Days")}</option><option value="RestorePoints">{t("Restore points")}</option></select></Field></div>
    <Toggle label={t("Synthetic full backups")} detail={t("Build a full backup from existing backup data on these days.")} checked={v.synthetic} onChange={synthetic=>set({synthetic})}/>{v.synthetic&&<DayPicker label={t("Synthetic full days")} value={v.syntheticDays} onChange={syntheticDays=>set({syntheticDays})}/>}
    <Toggle label={t("Active full backups")} detail={t("Read the complete workload from production. The backup chain remains incremental between fulls.")} checked={v.active} onChange={active=>set({active})}/>{v.active&&<DayPicker label={t("Active full days")} value={v.activeDays} onChange={activeDays=>set({activeDays})}/>}
    <Toggle label={t("Backup health checks")} detail={t("Check backup data for corruption on these days.")} checked={v.healthCheck} onChange={healthCheck=>set({healthCheck})}/>{v.healthCheck&&<DayPicker label={t("Health check days")} value={v.healthDays} onChange={healthDays=>set({healthDays})}/>}
    <details className={s.section}><summary className={s.link}>{t("Long-term retention (GFS)")}</summary><p className={s.muted}>{t("Keep selected full backups longer. Use 0 to turn a tier off.")}</p><div className={`${s.fields} ${s.section}`}>
      <Field label={t("Weekly fulls")} hint={t("Weeks to retain · Sunday")}><input type="number" min={0} max={9999} value={v.gfsWeeks} onChange={e=>set({gfsWeeks:Number(e.target.value)})}/></Field>
      <Field label={t("Monthly fulls")} hint={t("Months to retain · first week")}><input type="number" min={0} max={999} value={v.gfsMonths} onChange={e=>set({gfsMonths:Number(e.target.value)})}/></Field>
      <Field label={t("Yearly fulls")} hint={t("Years to retain · January")}><input type="number" min={0} max={999} value={v.gfsYears} onChange={e=>set({gfsYears:Number(e.target.value)})}/></Field>
    </div></details><p className={s.muted}>{t("Fulls run with scheduled job sessions. A full-backup day needs a corresponding run day or a manual run.")}</p>
  </>
}
export function GuestEditor({value:v,onChange,credentials}:{value:Guest;onChange:(value:Guest)=>void;credentials:BuilderOptions['credentials']}) {
  const { t } = useI18n()
  const set=(patch:Partial<Guest>)=>onChange({...v,...patch}),enabled=v.applicationAware||v.indexing
  return <><Toggle label={t("Application-aware processing")} detail={t("Coordinate the backup with supported applications inside the guest.")} checked={v.applicationAware} onChange={applicationAware=>set({applicationAware})}/>
    <Toggle label={t("Guest file indexing")} detail={t("Index Windows and Linux guest files to support file searches.")} checked={v.indexing} onChange={indexing=>set({indexing})}/>
    {enabled&&<div className={s.section}><Field label={t("Guest OS credentials")} hint={t("Uses an existing credential in this VBR source. Passwords are never stored in profiles.")}><select value={v.credentialId} onChange={e=>{const credential=credentials.find(c=>c.id===e.target.value);set({credentialId:e.target.value,credentialType:(credential?.type||'Standard') as Guest['credentialType']})}}><option value="">{t("Choose a saved credential")}</option>{v.credentialId&&!credentials.some(c=>c.id===v.credentialId)&&<option value={v.credentialId}>{t("Unavailable credential — choose another")}</option>}{credentials.map(c=><option key={c.id} value={c.id}>{c.username} · {credentialTypeLabel(t,c.type)}{c.description?` · ${c.description}`:''}</option>)}</select></Field></div>}
    {v.applicationAware&&<><Field label={t("If application processing fails")}><select value={v.vss} onChange={e=>set({vss:e.target.value as Guest['vss']})}><option value="RequireSuccess">{t("Fail the workload backup")}</option><option value="IgnoreFailures">{t("Continue with a crash-consistent backup")}</option></select></Field><div className={s.notice}>{t("Application processing uses copy-only mode. Transaction logs remain on the source; this profile does not truncate or schedule log backups.")}</div></>}
    {!enabled&&<p className={`${s.muted} ${s.section}`}>{t("The job will not run application-aware processing or guest file indexing. No guest credentials are required.")}</p>}
  </>
}
export function ScheduleEditor({value:v,onChange}:{value:Schedule;onChange:(value:Schedule)=>void}) {
  const { t } = useI18n()
  const set=(patch:Partial<Schedule>)=>onChange({...v,...patch})
  return <><div className={s.choiceRow}>{([{value:'manual',label:t('Manual'),Icon:Hand},{value:'daily',label:t('On a schedule'),Icon:CalendarClock},{value:'periodic',label:t('Repeat'),Icon:Clock3}] as const).map(({value,label,Icon})=><button type="button" className={s.choice} key={value} aria-pressed={v.mode===value} onClick={()=>set({mode:value})}><Icon size={15}/>{t(label)}</button>)}</div>
    {v.mode==='daily'&&<><Field label={t("Start time")} hint={t("Uses the VBR server’s local time.")}><input type="time" value={v.time} onChange={e=>set({time:e.target.value})}/></Field><div className={s.actions}><span className={s.muted}>{t("Run days")}</span><button type="button" className={s.link} onClick={()=>set({days:[...days]})}>{t("Every day")}</button><button type="button" className={s.link} onClick={()=>set({days:days.slice(0,5)})}>{t("Weekdays")}</button><button type="button" className={s.link} onClick={()=>set({days:['saturday','sunday']})}>{t("Weekends")}</button></div><DayPicker label={t("Run days")} value={v.days} onChange={days=>set({days})}/></>}
    {v.mode==='periodic'&&<div className={s.fields}><Field label={t("Repeat every")}><input type="number" min={1} max={999} value={v.interval} onChange={e=>set({interval:Number(e.target.value)})}/></Field><Field label={t("Time unit")}><select value={v.unit} onChange={e=>set({unit:e.target.value as Schedule['unit']})}><option value="Hours">{t("Hours")}</option><option value="Minutes">{t("Minutes")}</option></select></Field></div>}
    {v.mode==='manual'?<p className={s.muted}>{t("Create the job without an automatic schedule. Start it later from Jobs & Policies.")}</p>:<><Toggle label={t("Retry failed workloads")} detail={t("Retry failed tasks after the initial session.")} checked={v.retry} onChange={retry=>set({retry})}/>{v.retry&&<div className={`${s.fields} ${s.section}`}><Field label={t("Retry attempts")}><input type="number" min={1} max={99} value={v.retryCount} onChange={e=>set({retryCount:Number(e.target.value)})}/></Field><Field label={t("Wait between retries (minutes)")}><input type="number" min={1} max={1440} value={v.retryMinutes} onChange={e=>set({retryMinutes:Number(e.target.value)})}/></Field></div>}</>}
  </>
}
