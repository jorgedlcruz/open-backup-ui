"use client"
// Open Backup UI v1.0.2

import { Trans , useI18n } from '@/components/providers/i18n-provider'
import { useRef,useState } from 'react'
import Link from 'next/link'
import { BookOpen,Plus,Upload,Download,Copy,Save,Loader2,ArrowUpRight,RefreshCw } from 'lucide-react'
import { defaults,profileKinds,kindLabels,profileInput,compileRetention,compileSchedule,type ProfileInput,type Profile,type ProfileKind } from '@/lib/job-builder/model'
import { Field,RetentionEditor,GuestEditor,ScheduleEditor } from './policy-editors'
import { useBuilderResources,message,downloadJson } from './resources'
import { usePolicyPresentation } from './presentation'
import s from './builder.module.css'

const blank=(kind:ProfileKind):ProfileInput=>({kind,name:'',description:'',settings:structuredClone(defaults[kind])} as ProfileInput)
export function ProfileLibrary() {
  const { t, t: uiText, formatNumber, formatDate } = useI18n()
  const { summary: profileSummary, validationIssue, diagnostic, decodeProfileImport } = usePolicyPresentation()

  const {options,profiles,error,profileError,loading,refresh,saveProfile}=useBuilderResources()
  const [draft,setDraft]=useState<ProfileInput>(blank('retention')),[record,setRecord]=useState<Profile|null>(null);
  const [scope,setScope]=useState(''),[filter,setFilter]=useState('all'),[query,setQuery]=useState(''),[saving,setSaving]=useState(false),[feedback,setFeedback]=useState(''),[failure,setFailure]=useState('');
  const file=useRef<HTMLInputElement>(null)
  const set=(value:ProfileInput)=>{setDraft(value);setFeedback('');setFailure('')}
  function choose(profile:Profile) {set(profileInput.parse({name:profile.name,description:profile.description,kind:profile.kind,settings:profile.settings}));setRecord(profile);setScope(options?.sourceKey||'')}
  function fresh(kind:ProfileKind) {set(blank(kind));setRecord(null);setScope(options?.sourceKey||'')}
  async function save() {
    setFailure('');setFeedback('');const parsed=profileInput.safeParse(draft)
    if(!parsed.success){setFailure(parsed.error.issues.map(i=>validationIssue(i.message)).join(' '));return}
    if(scope&&scope!==options?.sourceKey){setFailure(t('The source changed. Select a profile or start a new one for this source.'));return}
    setSaving(true)
    try {const profile=await saveProfile(parsed.data,record?.id,record?.revision);choose(profile);setFeedback(t('Saved {name} · revision {revision}. Existing jobs are unchanged.', {name:profile.name,revision:formatNumber(profile.revision)}))}catch(e){setFailure(message(e))}finally{setSaving(false)}
  }
  async function importFile(value:File|undefined) {
    if(!value)return
    try {if(value.size>64000)throw new Error(t('Choose a profile JSON file smaller than 64 KB.'));const content=await value.text().catch(()=>{throw new Error(t('The profile file could not be read.'))});set(decodeProfileImport(content));setRecord(null);setScope(options?.sourceKey||'');setFeedback(t('Imported into the editor. Review credential references, then save to this source.'))}catch(e){setFailure(message(e))}
    if(file.current)file.current.value=''
  }
  const filtered=profiles.filter(p=>(filter==='all'||p.kind===filter)&&`${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name));
  const json=draft.kind==='retention'?compileRetention(draft.settings):draft.kind==='schedule'?compileSchedule(draft.settings):draft.settings;
  return <div className={s.page}><header className={s.header}><div><div className={s.eyebrow}><BookOpen size={14}/>{t("Reusable protection settings")}</div><h1><Trans>{"Policy Profiles"}</Trans></h1><p>{t("Define it once. Apply a copy to any new VMware or Hyper-V job.")}</p></div><div className={s.actions}><button className={s.button} onClick={()=>file.current?.click()} disabled={loading||saving}><Upload size={14}/>{t("Import JSON")}</button><Link className={s.primary} href="/vbr/jobs/create">{t("Create a job")}<ArrowUpRight size={14}/></Link></div></header>
    <input ref={file} type="file" accept=".json,application/json" className={s.hidden} aria-label={t("Import policy JSON")} onChange={e=>void importFile(e.target.files?.[0])}/>
    {loading?<div className={s.loading}><Loader2 className={s.spinner} size={18}/>{t("Loading this source’s policy profiles…")}</div>:error?<div role="alert" className={s.error}>{diagnostic(error)}<button className={s.button} onClick={refresh}><Trans>{"Retry"}</Trans></button></div>:options&&<>
      <div className={s.source}><i className={s.dot}/><b>{options.sourceName}</b><span>{t("Profiles belong to this source")}</span><button className={s.button} onClick={refresh} disabled={saving}><RefreshCw size={13}/><Trans>{"Refresh"}</Trans></button></div>
      {profileError&&<div role="alert" className={s.error}>{diagnostic(profileError)}</div>}
      <div className={s.libraryFilters}><input className={s.search} aria-label={uiText("Search profiles")} placeholder={uiText("Find a policy…")} value={query} onChange={e=>setQuery(e.target.value)}/><select className={s.select} aria-label={t("Policy category")} value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">{t("All categories")}</option>{profileKinds.map(k=><option key={k} value={k}>{t(kindLabels[k])}</option>)}</select><button className={s.button} onClick={()=>fresh(filter==='all'?'retention':filter as ProfileKind)}><Plus size={14}/>{t("New")}</button></div>
      <div className={s.library}><aside className={s.libraryList} aria-label={t("Saved profiles")}>{filtered.length?filtered.map(p=><button className={s.profileCard} data-selected={record?.id===p.id} onClick={()=>choose(p)} key={p.id}><span className={s.tag}>{t(kindLabels[p.kind])}</span><h3>{p.name}</h3><p>{profileSummary(p.kind,p.settings)}</p>{p.description&&<p>{p.description}</p>}<small>{t('Revision {revision} · {date}', {revision:formatNumber(p.revision), date:formatDate(p.updatedAt)})}</small></button>):<div className={s.panel}><div className={s.empty}>{profiles.length?t("No profiles match your search."):t("Your library starts here. Save the settings your jobs share, then reuse them in the job builder.")}</div></div>}</aside>
        <section className={s.panel} aria-label={t("Profile editor")}><div className={s.panelHead}><div><h2>{record?t("Edit profile"):t("New profile")}</h2><p>{t("Changes apply when you use this profile in a new job.")}</p></div>{record&&<button className={s.button} onClick={()=>{set({...draft,name:t('{name} copy',{name:draft.name})});setRecord(null)}}><Copy size={14}/>{t("Duplicate")}</button>}</div><div className={s.panelBody}>
          <div className={s.fields}><Field label={t("Category")}><select value={draft.kind} disabled={!!record||saving} onChange={e=>fresh(e.target.value as ProfileKind)}>{profileKinds.map(k=><option key={k} value={k}>{t(kindLabels[k])}</option>)}</select></Field><Field label={t("Profile name")}><input maxLength={100} placeholder={t("e.g. Production · 30 days")} value={draft.name} onChange={e=>set({...draft,name:e.target.value})}/></Field></div>
          <Field label={t("Description")}><textarea maxLength={500} placeholder={t("When should this policy be used?")} value={draft.description} onChange={e=>set({...draft,description:e.target.value})}/></Field>
          {draft.kind==='retention'?<RetentionEditor value={draft.settings} onChange={settings=>set({...draft,settings})}/>:draft.kind==='guest'?<GuestEditor value={draft.settings} credentials={options.credentials} onChange={settings=>set({...draft,settings})}/>:<ScheduleEditor value={draft.settings} onChange={settings=>set({...draft,settings})}/>}
          {draft.kind==='guest'&&(draft.settings.applicationAware||draft.settings.indexing)&&!options.credentials.some(c=>c.id===draft.settings.credentialId)&&<div className={s.notice}>{t("Select a credential from this source before using the profile.")}</div>}
          <details className={s.policyPreview}><summary className={s.link}>{draft.kind==='guest'?t("Profile JSON"):t("Native API fragment")}</summary><pre className={`${s.code} ${s.section}`}>{JSON.stringify(json,null,2)}</pre></details>
          {failure&&<div className={s.error} role="alert">{diagnostic(failure)}</div>}{feedback&&<div className={s.success} role="status">{feedback}</div>}
          <div className={s.saveBar}><button className={s.button} disabled={!profileInput.safeParse(draft).success} onClick={()=>downloadJson(`${draft.name.replace(/[^a-z0-9-]/gi,'-')||'profile'}.json`,{schemaVersion:1,profile:profileInput.parse(draft)})}><Download size={14}/>{t("Export JSON")}</button><button className={s.primary} disabled={saving||!!profileError} onClick={()=>void save()}>{saving?<Loader2 size={14} className={s.spinner}/>:<Save size={14}/>}{t("Save profile")}</button></div>
        </div></section></div></>}
  </div>
}
