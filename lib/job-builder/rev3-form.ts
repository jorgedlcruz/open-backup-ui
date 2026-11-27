// Open Backup UI v1.3.0
import contract from './rev3-contract.json'
import type { NativeJobType } from './native-job-types'

export type Field = {
  $ref?:string; type?:string; const?:string; enum?:string[]; format?:string; properties?:Record<string,Field>;
  required?:string[]; items?:Field; oneOf?:Field[]; anyOf?:Field[]; minimum?:number; maximum?:number;
  minLength?:number; maxLength?:number
}
export type NativeRecord = Record<string,unknown>
export const isRecord=(value:unknown):value is NativeRecord=>!!value && typeof value==='object' && !Array.isArray(value)
export function fieldDefinition(field:Field):Field {
  if(field.$ref)return (contract.definitions as Record<string,Field>)[field.$ref.slice('#/$defs/'.length)]
  const nonNull=field.anyOf?.find(item=>item.type!=='null')
  return nonNull?fieldDefinition(nonNull):field
}
export function jobDefinition(type:NativeJobType,edit:boolean):Field {
  return (contract.definitions as Record<string,Field>)[contract.jobs[type][edit?'edit':'create']]
}
export function variantOf(field:Field,value:unknown,preferred?:string) {
  const fields=field.oneOf?.map(fieldDefinition) || []
  const tagged=(variant:Field)=>Object.entries(variant.properties||{}).find(([,child])=>child.const!==undefined)
  const options=fields.map(variant=>({field:variant,tag:tagged(variant)}))
  return options.find(({tag})=>tag && isRecord(value) && value[tag[0]]===tag[1].const) ??
    options.find(({tag})=>tag?.[1].const===preferred) ?? options[0]
}
export function initialField(input:Field,preferred?:string):unknown {
  const field=fieldDefinition(input)
  if(field.const!==undefined)return field.const
  if(field.oneOf)return initialField(variantOf(field,undefined,preferred).field,preferred)
  if(field.enum)return field.enum[0]
  if(field.type==='object')return Object.fromEntries((field.required||[]).map(k=>[k,initialField(field.properties![k],preferred)]))
  if(field.type==='array')return []
  if(field.type==='boolean')return false
  if(field.type==='integer'||field.type==='number')return field.minimum??0
  return ''
}
export function publicFieldName(name:string) {
  if(name==='id')return 'ID'
  return name.replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/^./,s=>s.toUpperCase()).replace(/\bId\b/g,'ID')
}
