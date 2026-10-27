export type Row = Record<string, unknown>
export const obj = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
export const str = (value: unknown) => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
export const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []
export const display = (value: unknown): string => value === null || value === undefined ? 'Not reported' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
export const numeric = (value: unknown): number | null => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) ? Number(value) : null
export const safeLink = (value: unknown) => { try { const url = new URL(str(value)); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null } catch { return null } }
export class ReportError extends Error { constructor(message: string, public status = 502) { super(message) } }
export interface Template { id: number; uid: string; name: string; description: string; packId: number; pack: string; infrastructure: string; tags: number[]; embedded: boolean; offline: boolean; restriction: string; community: boolean | null; views: number | null }
export function template(value: unknown): Template {
  const r = obj(value)
  if (!Number.isSafeInteger(r.reportTemplateId) || !Number.isSafeInteger(r.packId)) throw new ReportError('Veeam ONE returned an invalid report template.')
  return {id:r.reportTemplateId as number,uid:str(r.uid),name:str(r.name),description:str(r.description),packId:r.packId as number,pack:str(r.packName),infrastructure:str(r.infrastructure),tags:list(r.tags).filter((v): v is number=>Number.isSafeInteger(v)),embedded:r.hasWebPreview===true,offline:r.offlineReport===true,restriction:str(r.restrictionType)||'Not reported',community:typeof r.community==='boolean'?r.community:null,views:numeric(r.viewsCount)}
}
export interface Parameter { id: number; name: string; label: string; required: boolean; visible: boolean; type: string; min: number | null; max: number | null; value: unknown; group: string; groupType: string; groupValue: string; order: number; typeId: number; control: string; dependent: boolean; sources: {id:number; dependent:boolean}[] }
export function parameter(value: unknown): Parameter {
  const r=obj(value),t=obj(r.extensionParameterType)
  return {id:Number(r.parameterId),name:str(r.name),label:str(r.displayName)==='-'?(r.name==='IntervalPeriod'?'RPO unit':str(r.name)):str(r.displayName)||str(r.name),required:r.required===true,visible:r.visible!==false,type:str(r.valueType),min:numeric(r.minValue),max:numeric(r.maxValue),value:r.defaultValue ?? null,group:str(r.groupName),groupType:str(r.groupType),groupValue:str(r.groupValue),order:numeric(r.order)??0,typeId:Number(t.parameterTypeId),control:str(t.uiType)||str(t.name),dependent:!!r.dependence,sources:list(t.dataSources).map(obj).filter(s=>Number.isSafeInteger(s.datasourceId)).map(s=>({id:s.datasourceId as number,dependent:s.requireParameters===true}))}
}
export function enabled(p:Parameter,values:Row) { return p.groupType==='radio' ? values[p.group]===p.groupValue : p.groupType==='inverseRadio' ? values[p.group]!==p.groupValue : true }
export function validateValues(parameters:Parameter[],values:Row): {name:string;value:unknown}[] {
  if(Object.keys(values).some(key=>!parameters.some(p=>p.name===key)))throw new ReportError('Unknown report parameter.',400)
  const merged=Object.fromEntries(parameters.map(p=>[p.name,Object.hasOwn(values,p.name)?values[p.name]:p.value]))
  const from=parameters.find(p=>p.name==='DateFrom'),to=parameters.find(p=>p.name==='DateTo')
  if(from&&to&&enabled(from,merged)&&enabled(to,merged)&&merged.DateFrom&&merged.DateTo&&Date.parse(str(merged.DateFrom))>Date.parse(str(merged.DateTo)))throw new ReportError('Start Date must be on or before End Date.',400)
  return parameters.map(p=>{
    let value=merged[p.name]
    if(!enabled(p,merged))value=Array.isArray(p.value)?[]:p.type==='Boolean'?false:null
    else {
      const missing=value===null || value===undefined || value==='' || Array.isArray(value)&&!value.length
      if(p.required && missing)throw new ReportError(`${p.label} is required.`,400)
      if(!missing){
        if(/Array$/.test(p.type) && (!Array.isArray(value)||value.some(v=>typeof v!=='string' && typeof v!=='number')))throw new ReportError(`${p.label} must contain a list of values.`,400)
        if(p.type==='Boolean' && typeof value!=='boolean')throw new ReportError(`${p.label} must be true or false.`,400)
        if(/^(Int|Integer|Decimal|Double|Float)$/.test(p.type)){
          if(typeof value!=='number'||!Number.isFinite(value)||/^Int/.test(p.type)&&!Number.isSafeInteger(value))throw new ReportError(`${p.label} must be a valid number.`,400)
          if(p.max!==null && p.min!==null && p.max>p.min && (value<p.min || value>p.max))throw new ReportError(`${p.label} must be between ${p.min} and ${p.max}.`,400)
        }
        if(p.type==='String' && typeof value!=='string')throw new ReportError(`${p.label} must be text.`,400)
        if(p.type==='DateTime' && (typeof value!=='string'||!Number.isFinite(Date.parse(value))||/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value).toISOString().slice(0,10)!==value))throw new ReportError(`${p.label} must be a valid date.`,400)
        if(typeof value==='string' && p.max!==null && p.max>0 && p.type==='String' && value.length>p.max)throw new ReportError(`${p.label} is too long.`,400)
      }
    }
    return {name:p.name,value:value??null}
  })
}
export interface Choice { value: string; label: string; selectable: boolean }
export function choices(value: unknown, parent='', depth=0):Choice[] {
  if(depth>30)return []
  return list(value).flatMap(v=>{const r=obj(v),label=[parent,str(r.name)||str(r.value)||str(r.id)].filter(Boolean).join(' / ');return [{value:str(r.id),label,selectable:r.selectable!==false},...choices(r.childs||r.children,label,depth+1)]}).filter(c=>c.value!=='')
}
export interface Section { id:string; type:string; name:string; data:Row }
export function sections(value:unknown):Section[] {return list(obj(value).sections).map(obj).filter(r=>str(r.id)).map(r=>({id:str(r.id),type:str(r.type),name:str(obj(r.data).name)||str(obj(r.data).label)||(r.type==='summary'?'Report summary':r.type==='parameters'?'Applied parameters':str(r.id).replaceAll('_',' ')),data:obj(r.data)}))}
export interface SectionState {id:string;status:string}
export interface RunStatus {runId:string;state:string;sections:SectionState[];created:string;started:string;error:string|null;resourceStatus:string; nested:unknown[]}
export function state(value:unknown):Omit<RunStatus,'runId'|'started'> & {resource:string} {
  const r=obj(value),result=obj(r.result),data=obj(result.data),failed=r.state==='Failed'||result.success===false||!!data.errorMessage
  return {state:failed?'Failed':str(r.state)||'Unknown',resource:str(data.resourceId),sections:list(data.sections).map(obj).filter(s=>str(s.sectionId)).map(s=>({id:str(s.sectionId),status:str(s.status)||'Unknown'})),created:str(data.resourceCreated),resourceStatus:str(data.resourceStatus),error:failed?'Veeam ONE could not generate this report. Review the parameters or open it in Veeam ONE for details.':null,nested:list(data.nestedSections)}
}
export function terminal(status:string){return ['Completed','Failed','Canceled'].includes(status)}
export interface PageData {items:unknown[];total:number|null;offset:number;limit:number;columns:{id:string;name:string}[];warning:string|null}
export function pageData(value:unknown,offset:number,limit:number):PageData {
  const r=obj(value),items=Array.isArray(value)?value:r.items
  if(!Array.isArray(items))throw new ReportError('Veeam ONE returned an unreadable report section. Retry this section.')
  const total=numeric(r.totalCount)
  return {items,total:total!==null&&Number.isSafeInteger(total)&&total>=0?total:null,offset,limit,columns:[],warning:items.length>limit?'The server returned more rows than requested. All returned rows are shown.':null}
}
export interface ChartPoint {label:string;value:number;formatted:string;color:string;series:string}
export function chartPoints(section:Section,items:unknown[]):ChartPoint[] {
  const d=section.data,series=list(d.series).map(obj),fields=series.length?series:[{fieldY:'value'}]
  return items.flatMap(item=>{const r=obj(item);return fields.flatMap(s=>{const field=str(s.fieldY)||'value',value=numeric(r[field]);if(value===null)return [];return [{label:str(r[str(d.fieldX)])||str(r[str(d.groupBy)])||str(r.group_datetime)||str(r.group_string)||str(r.group)||str(r.key)||'Unnamed',value,formatted:str(r[`${field}_formatted_`])||display(r[field]),color:str(r[str(s.colorRefField)||'color']),series:str(s.name)||str(s.label)||(str(d.fieldX)&&str(d.groupBy)?str(r[str(d.groupBy)]):fields.length>1?field:'')}]})})
}
export interface Catalog {source:string;sourceKey:string;templates:Template[];tags:{id:number;name:string}[];warnings:string[]}
export interface Definition {source:string;sourceKey:string;template:Template;parameters:Parameter[];sections:Section[];link:string|null;warnings:string[];saved:Row|null;canRun:boolean}
export const matchesTemplate=(t:Template,query:string,pack:string,platform:string,mode:string,tags:Set<string>)=>(!query||`${t.name} ${t.description} ${t.pack} ${t.infrastructure}`.toLowerCase().includes(query.toLowerCase()))&&(!pack||t.pack===pack)&&(!platform||t.infrastructure===platform)&&(!mode||(mode==='embedded'?t.embedded:mode==='native'?!t.embedded:mode==='restricted'?t.restriction!=='None':t.offline))&&(!tags.size||t.tags.some(id=>tags.has(String(id))))
