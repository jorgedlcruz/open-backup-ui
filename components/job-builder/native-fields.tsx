'use client'
// Open Backup UI v1.3.0
import { useId } from 'react'
import { useI18n } from '@/components/providers/i18n-provider'
import { fieldDefinition, initialField, isRecord, publicFieldName, variantOf, type Field } from '@/lib/job-builder/rev3-form'
import s from './builder.module.css'
import { PlatformObjects,usePlatformOptions } from './platform-options'

export function NativeField({name,schema,value,onChange,preferred,depth=0}:{name:string;schema:Field;value:unknown;
  onChange:(value:unknown)=>void;preferred?:string;depth?:number}) {
  const {t}=useI18n(), id=useId(), field=fieldDefinition(schema), label=t(publicFieldName(name))
  const platform=usePlatformOptions()
  if(platform&&field.type==='array'&&['includes','excludes'].includes(name))return <PlatformObjects label={label} value={value} onChange={onChange}/>
  if(platform&&name==='backupRepositoryId'){
    const repositories=platform.options?.repositories||[]
    return <label className={s.field}>{t('Backup repository')}<select value={String(value||'')} onChange={e=>onChange(e.target.value)}>
      <option value="">{t('Choose a repository')}</option>
      {value && !repositories.some(r=>r.id===value)?<option value={String(value)}>{String(value)}</option>:null}
      {repositories.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
    </select></label>
  }
  if(field.oneOf){
    const options=field.oneOf.map(fieldDefinition)
    const selected=variantOf(field,value,preferred)
    return <div className="grid gap-2"><label htmlFor={id}>{label}</label><select id={id} className={s.select}
      value={options.indexOf(selected.field)} onChange={e=>onChange(initialField(options[Number(e.target.value)],preferred))}>
      {options.map((option,i)=><option key={i} value={i}>{Object.values(option.properties||{}).find(child=>child.const)?.const||i+1}</option>)}
      </select><NativeField name={name} schema={selected.field} value={value} onChange={onChange} preferred={preferred} depth={depth+1}/></div>
  }
  if(field.const!==undefined)return null
  if(field.type==='object'){
    const data=isRecord(value)?value:{}
    return <fieldset className={depth===0?'grid gap-3':'grid gap-3 rounded-lg border p-3'} aria-label={label}>{depth>0&&<legend className="px-1 font-medium">{label}</legend>}
      {Object.entries(field.properties||{}).filter(([,child])=>child.const===undefined).map(([key,child])=>{
        const required=field.required?.includes(key), present=Object.hasOwn(data,key)
        if(!required && fieldDefinition(child).type==='boolean'){
          return <label key={key} className={s.field}>{t(publicFieldName(key))}
            <select value={present && typeof data[key]==='boolean'?String(data[key]):''} onChange={e=>{
              const next={...data}
              if(e.target.value==='')delete next[key]
              else next[key]=e.target.value==='true'
              onChange(next)
            }}>
              <option value="">{t('Default')}</option><option value="true">{t('Yes')}</option><option value="false">{t('No')}</option>
            </select></label>
        }
        return <div key={key}>{!required&&<label className="flex items-center gap-2 pb-1 text-sm">
          <input type="checkbox" checked={present} onChange={e=>{
            const next={...data}
            if(e.target.checked)next[key]=initialField(child,preferred)
            else delete next[key]
            onChange(next)
          }}/>{t(publicFieldName(key))}</label>}
          {(required||present)&&<NativeField name={key} schema={child} value={data[key]} onChange={v=>onChange({...data,[key]:v})}
            preferred={preferred} depth={depth+1}/>}</div>
      })}</fieldset>
  }
  if(field.type==='array'){
    const values=Array.isArray(value)?value:[]
    return <fieldset className="grid gap-2 rounded-lg border p-3"><legend className="px-1">{label}</legend>
      {values.map((v,i)=><div className="grid gap-1" key={i}><NativeField name={name} schema={field.items!} value={v}
        onChange={item=>onChange(values.map((old,index)=>index===i?item:old))} preferred={preferred} depth={depth+1}/>
        <button type="button" className={s.link} onClick={()=>onChange(values.filter((_,index)=>index!==i))}>{t('Remove')}</button></div>)}
      <button type="button" className={s.button} onClick={()=>onChange([...values,initialField(field.items!,preferred)])}>{t('Add')}</button></fieldset>
  }
  if(field.type==='boolean')return <label className="flex items-center gap-2"><input type="checkbox" checked={value===true} onChange={e=>onChange(e.target.checked)}/>{label}</label>
  if(field.enum)return <label className={s.field}>{label}<select value={String(value??'')} onChange={e=>onChange(e.target.value)}>{field.enum.map(v=><option key={v} value={v}>{t(v)}</option>)}</select></label>
  const numeric=field.type==='integer'||field.type==='number'
  return <label className={s.field}>{label}<input type={numeric?'number':'text'} value={typeof value==='number'||typeof value==='string'?value:''}
    min={field.minimum} max={field.maximum} step={field.type==='integer'?1:undefined} maxLength={field.maxLength}
    placeholder={field.format==='uuid'?'UUID':undefined} onChange={e=>onChange(numeric && e.target.value!==''?Number(e.target.value):e.target.value)}/></label>
}
