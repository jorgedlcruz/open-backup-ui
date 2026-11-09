"use client"
// Open Backup UI v1.0.2

import { useI18n } from '@/components/providers/i18n-provider'
import { useState } from 'react'
import { Archive,CalendarClock,ShieldCheck,Save,Loader2 } from 'lucide-react'
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/components/ui/dialog'
import { kindLabels,profileKinds,profileInput,type Draft,type Profile,type ProfileInput,type ProfileKind } from '@/lib/job-builder/model'
import type { BuilderOptions } from '@/lib/job-builder/load'
import { Field,RetentionEditor,GuestEditor,ScheduleEditor } from './policy-editors'
import { message } from './resources'
import { usePolicyPresentation } from './presentation'
import s from './builder.module.css'

export function PolicyCards({draft,onChange,options,profiles,saveProfile}:{draft:Draft;onChange:(patch:Partial<Draft>)=>void;options:BuilderOptions;profiles:Profile[];saveProfile:(input:ProfileInput)=>Promise<Profile>}) {
  const { t, formatNumber } = useI18n()
  const { summary: profileSummary, validationIssue, diagnostic } = usePolicyPresentation()
  const [savingKind,setSavingKind]=useState<ProfileKind|null>(null),[name,setName]=useState(''),[description,setDescription]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  async function save() {if(!savingKind)return;const result=profileInput.safeParse({name,description,kind:savingKind,settings:draft[savingKind]});if(!result.success){setError(result.error.issues.map(i=>validationIssue(i.message)).join(' '));return}setSaving(true);setError('');try{const profile=await saveProfile(result.data);setNotice(t('Saved “{name}” to Policy Profiles.',{name:profile.name}));setSavingKind(null)}catch(e){setError(message(e))}finally{setSaving(false)}}
  return <>{profileKinds.map(kind=>{const Icon={retention:Archive,guest:ShieldCheck,schedule:CalendarClock}[kind],matching=profiles.filter(p=>p.kind===kind);return<section key={kind} className={s.panel}>
    <div className={s.panelBody}><div className={s.policyHeader}><div className={s.policyIcon}><Icon size={17}/></div><div><h2 style={{fontSize:15,fontWeight:550,marginBottom:5}}>{t(kindLabels[kind])}</h2><p className={s.muted}>{profileSummary(kind,draft[kind])}</p></div></div><div className={s.policyTools}><select className={s.select} aria-label={t('{category} profile',{category:t(kindLabels[kind])})} value="" disabled={!matching.length} onChange={e=>{const p=matching.find(p=>p.id===e.target.value);if(p){onChange({[kind]:structuredClone(p.settings)});setNotice(t('Copied “{name}” into this job. You can customize the copy below.',{name:p.name}))}}}><option value="">{matching.length?t("Apply a saved profile…"):t("No saved profiles yet")}</option>{matching.map(p=><option key={p.id} value={p.id}>{t('{name} · revision {revision}',{name:p.name,revision:formatNumber(p.revision)})}</option>)}</select><button className={s.button} onClick={()=>{setSavingKind(kind);setName('');setDescription('');setError('')}}><Save size={13}/>{t("Save as profile")}</button></div></div>
    <details className={s.disclosure}><summary>{t(kind==='guest'?'Customize guest processing':kind==='retention'?'Customize retention':'Customize schedule')}</summary><div className={s.section}>{kind==='retention'?<RetentionEditor value={draft.retention} onChange={retention=>onChange({retention})}/>:kind==='guest'?<GuestEditor value={draft.guest} onChange={guest=>onChange({guest})} credentials={options.credentials}/>:<ScheduleEditor value={draft.schedule} onChange={schedule=>onChange({schedule})}/>}</div></details>
  </section>})}{notice&&<div className={s.success} role="status">{notice}</div>}<p className={s.muted}>{t("Applying a profile copies its settings into this job. Customize the copy freely; changes to the library never silently update existing jobs.")}</p>
    <Dialog open={!!savingKind} onOpenChange={open=>{if(!saving&&!open)setSavingKind(null)}}><DialogContent><DialogHeader><DialogTitle>{t("Save a reusable profile")}</DialogTitle><DialogDescription>{savingKind?t(kindLabels[savingKind]):''} · {options.sourceName}</DialogDescription></DialogHeader><div className={s.dialogBody}><Field label={t("Profile name")}><input maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder={t("e.g. Production · nightly")}/></Field><Field label={t("Description")}><textarea maxLength={500} value={description} onChange={e=>setDescription(e.target.value)}/></Field>{error&&<div className={s.error} role="alert">{diagnostic(error)}</div>}<button className={s.primary} onClick={()=>void save()} disabled={saving}>{saving?<Loader2 size={15} className={s.spinner}/>:<Save size={15}/>}{t("Save profile")}</button></div></DialogContent></Dialog>
  </>
}
