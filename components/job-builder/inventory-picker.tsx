"use client"
// Open Backup UI v1.0.2
import { useI18n } from '@/components/providers/i18n-provider'

import { useEffect,useState } from 'react'
import { Boxes,Server,Monitor,Loader2,X } from 'lucide-react'
import { applicationRequest } from '@/lib/api/application-request'
import { objectKey,type Draft,type JobObject } from '@/lib/job-builder/model'
import type { BuilderOptions } from '@/lib/job-builder/load'
import { Field } from './policy-editors'
import { message } from './resources'
import { usePolicyPresentation } from './presentation'
import s from './builder.module.css'

export function InventoryPicker({draft,onChange,options}:{draft:Draft;onChange:(patch:Partial<Draft>)=>void;options:BuilderOptions}) {
  const { t, t: uiText, formatNumber } = useI18n()
  const {enumText,diagnostic} = usePolicyPresentation()

  const hosts=options.hosts.filter(h=>h.platform===draft.platform);
  const [chosenHost,setHost]=useState(''),[query,setQuery]=useState(''),[type,setType]=useState('all'),[mode,setMode]=useState<'includes'|'excludes'>('includes');
  const [objects,setObjects]=useState<JobObject[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[complete,setComplete]=useState(true)
  const host=hosts.some(h=>h.name===chosenHost)?chosenHost:hosts[0]?.name||''
  useEffect(()=>{
    if(!host)return
    const controller=new AbortController();setLoading(true);setError('');setObjects([])
    void applicationRequest<{sourceKey:string;data:JobObject[];complete:boolean}>(`/api/vbr/job-builder/inventory?host=${encodeURIComponent(host)}&platform=${draft.platform}`,{signal:controller.signal})
      .then(value=>{if(!controller.signal.aborted){if(value.sourceKey!==options.sourceKey)throw new Error('The source changed. Refresh the job builder.');setObjects(value.data);setComplete(value.complete)}})
      .catch(e=>{if(!controller.signal.aborted)setError(message(e))}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return ()=>controller.abort()
  },[host,draft.platform,options.sourceKey,options.fetchedAt])
  const selected=new Set(draft[mode].map(objectKey)),other=new Set(draft[mode==='includes'?'excludes':'includes'].map(objectKey))
  const visible=objects.filter(o=>(type==='all'||o.type===type)&&`${o.name} ${enumText(o.type)} ${o.objectId}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name))
  function toggle(object:JobObject) {const key=objectKey(object);onChange({[mode]:selected.has(key)?draft[mode].filter(o=>objectKey(o)!==key):[...draft[mode],object]})}
  return <><div className={s.fields}><Field label={t("Inventory server")}><select value={host} onChange={e=>{setHost(e.target.value);setType('all');setQuery('')}}>{!hosts.length&&<option>{t("No inventory servers available")}</option>}{hosts.map(h=><option key={h.name} value={h.name}>{h.name}</option>)}</select></Field><Field label={t("Selection purpose")}><select value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="includes">{t("Protect these objects")}</option><option value="excludes">{t("Exclude these objects")}</option></select></Field></div>
    <div className={s.inventoryTools}><input className={s.search} aria-label={uiText("Search inventory")} placeholder={uiText("Find a VM, cluster, host or folder…")} value={query} onChange={e=>setQuery(e.target.value)}/><select className={s.select} aria-label={t("Inventory object type")} value={type} onChange={e=>setType(e.target.value)}><option value="all">{t("All object types")}</option>{[...new Set(objects.map(o=>o.type))].sort().map(type=><option key={type} value={type}>{enumText(type)}</option>)}</select></div>
    {error&&<div className={s.error} role="alert">{diagnostic(error)}</div>}{!complete&&!loading&&<div className={s.notice}>{t("VBR returned a partial inventory. Refresh the source before relying on a missing object.")}</div>}
    <div className={s.inventory} aria-label={t("Available inventory")}>{loading?<div className={s.loading}><Loader2 size={17} className={s.spinner}/>{t("Reading inventory…")}</div>:!visible.length?<div className={s.empty}>{hosts.length?t("No objects match this selection."):t("Connect an inventory server in VBR first.")}</div>:visible.slice(0,300).map(o=>{const key=objectKey(o),Icon=o.type==='VirtualMachine'?Monitor:['Host','Cluster'].includes(o.type)?Server:Boxes;return<div className={s.object} key={key}><label><input type="checkbox" checked={selected.has(key)} disabled={other.has(key)||(!selected.has(key)&&draft[mode].length>=500)} onChange={()=>toggle(o)}/><Icon size={15}/><div><strong>{o.name}</strong><small>{enumText(o.type)} · {o.hostName}{o.size?` · ${o.size}`:''}{other.has(key)?` · ${t('Selected in the other list')}`:''}</small></div></label></div>})}</div>
    <p className={`${s.muted} ${s.section}`}>{visible.length>300?t('Showing 300 of {count} matches. Narrow your search.',{count:formatNumber(visible.length)}):t('{count} matching objects.',{count:formatNumber(visible.length)})}{' '}{t("Containers include current and future workloads; selected-object counts are not VM counts.")}</p>
    {(['includes','excludes'] as const).map(field=><details key={field} className={s.selectedList} open={draft[field].length>0}><summary>{field==='includes'?t("Protected scope"):t("Exclusions")} · {formatNumber(draft[field].length)}</summary>{draft[field].map(o=><div className={s.object} key={objectKey(o)}><div><strong>{o.name}</strong><small>{enumText(o.type)} · {o.hostName}</small></div><button aria-label={t(field==='includes'?'Remove {name} from protected scope':'Remove {name} from exclusions',{name:o.name})} onClick={()=>onChange({[field]:draft[field].filter(v=>objectKey(v)!==objectKey(o))})}><X size={14}/></button></div>)}</details>)}
  </>
}
