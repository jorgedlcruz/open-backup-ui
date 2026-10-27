import { ReportError, obj, str, list, template, parameter, sections, choices, validateValues, safeLink, state, pageData, type Template, type Definition, type RunStatus, type Row } from './model'
export type Execute=(path:string,method?:'GET'|'POST',body?:unknown,once?:boolean)=>Promise<unknown>
const api='/api/v2.3'
export async function catalog(execute:Execute){
  const templates:Template[]=[],warnings:string[]=[],seen=new Set<number>()
  for(let offset=0;offset<10000;){
    const raw=await execute(`${api}/reportPacks/templates?Offset=${offset}&Limit=500`),r=obj(raw),rows=Array.isArray(raw)?raw:r.items
    if(!Array.isArray(rows))throw new ReportError('Veeam ONE did not return a readable report catalog.')
    let added=0
    for(const value of rows){const t=template(value);if(!seen.has(t.id)){templates.push(t);seen.add(t.id);added++}}
    offset+=rows.length
    if(typeof r.totalCount==='number'?offset>=r.totalCount:rows.length<500)break
    if(!added || offset>=10000){warnings.push('The catalog is partial because the server did not provide further pages.');break}
  }
  let tags:{id:number;name:string}[]=[]
  try{const raw=await execute(`${api}/reportPacks/tags`);tags=list(Array.isArray(raw)?raw:obj(raw).items).map(obj).map(r=>({id:Number(r.tagId),name:str(r.tag)}))}catch(e){rethrowAuth(e);warnings.push('Report tags could not be loaded.')}
  return {templates,tags,warnings}
}
export function rethrowAuth(e:unknown){if(e instanceof ReportError && [401,403,409].includes(e.status))throw e}
export async function definition(execute:Execute,id:string,presentation=true):Promise<Omit<Definition,'source'|'sourceKey'>>{
  const data=await catalog(execute),savedId=id.startsWith('saved-')?Number(id.slice(6)):null
  const saved=savedId?obj(await execute(`${api}/reports/${savedId}`)):null
  const t=data.templates.find(t=>saved?t.id===saved.reportTemplateId:t.uid===id||String(t.id)===id)
  if(!t)throw new ReportError('This report was not found in the selected Veeam ONE catalog.',404)
  const warnings=[...data.warnings],base=`${api}/reportPacks/${t.packId}/templates/${t.id}`
  const detail=obj(await execute(base))
  let params:ReturnType<typeof parameter>[]=[],layout:ReturnType<typeof sections>=[],link:string|null=null,canRun=t.embedded
  try{const raw=await execute(`${base}/parameters`);if(!Array.isArray(raw))throw new Error();params=raw.map(parameter).sort((a,b)=>a.order-b.order)}catch(e){rethrowAuth(e);warnings.push('Parameter definitions could not be loaded. Retry before running this report.');canRun=false}
  if(saved){
    const values=list(saved.parameterValues).map(obj)
    if(values.some(v=>!params.some(p=>p.id===v.reportParameterId))){canRun=false;warnings.push('Some saved parameters cannot be mapped to this template. Open the saved report in Veeam ONE to preserve its configuration.')}
    params=params.map(p=>{const v=values.find(v=>v.reportParameterId===p.id);return v?{...p,value:v.value}:p})
  }
  if(presentation && t.embedded && Number.isSafeInteger(detail.webViewTemplateResourceId)){
    try{layout=sections(await execute(`${api}/resources/${detail.webViewTemplateResourceId}`))}catch(e){rethrowAuth(e);warnings.push('Report layout could not be read. Results will use the section metadata and data tables.')}
  }
  if(presentation)try{const raw=await execute(saved?`${api}/reports/${savedId}/directLink`:`${api}/reportPacks/templates/${t.id}/link`);link=safeLink(saved?obj(raw).link:raw)}catch(e){rethrowAuth(e);warnings.push('The link to Veeam ONE could not be loaded.')}
  return {template:saved?{...t,name:str(saved.name)||t.name,description:str(saved.description)||t.description}:t,parameters:params,sections:layout,link,warnings,saved,canRun}
}
export async function parameterChoices(execute:Execute,definition:Pick<Definition,'parameters'>,name:string,values:Row){
  const p=definition.parameters.find(p=>p.name===name)
  if(!p || !p.sources.length)throw new ReportError('This parameter has no choice data source.',400)
  const source=p.sources[0],path=`${api}/reportPacks/templates/parameterTypes/${p.typeId}/datasource/${source.id}`
  const defs=list(await execute(`${path}/parameters`)).map(obj)
  // Choice queries use only their declared dependencies; preserve their server defaults.
  const parameters=defs.map(d=>{const name=str(d.parameterName),spec=definition.parameters.find(p=>p.name===name);let value=Object.hasOwn(values,name)?values[name]:spec?.value??d.defaultValue;if(spec?.type==='XmlArray' && Array.isArray(value))value=`<root>${value.map(v=>`<id>${String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}</id>`).join('')}</root>`;else if(Array.isArray(value))value=value.join(',');return {name,value}})
  const raw=await execute(`${path}/data?Offset=0&Limit=1000`,'POST',parameters)
  const rows=Array.isArray(raw)?raw:obj(raw).items
  if(!Array.isArray(rows))throw new ReportError('The parameter choices could not be read.')
  return {choices:choices(rows),partial:rows.length>=1000||typeof obj(raw).totalCount==='number'&&Number(obj(raw).totalCount)>rows.length}
}
export interface StoredRun {key:string;templateId:string;sessionId:string;executionId:string;resource:string;definition:Awaited<ReturnType<typeof definition>>;status:RunStatus;expires:number}
export async function start(execute:Execute,detail:Awaited<ReturnType<typeof definition>>,values:Row){
  if(!detail.canRun)throw new ReportError('Open this report in Veeam ONE or reload its parameter definitions.',400)
  const parameters=validateValues(detail.parameters,values),session=obj(await execute(`${api}/webview/sessions/start`,'POST',{},true))
  if(!str(session.sessionId))throw new ReportError('Veeam ONE did not create a report session.')
  try{
    const result=obj(await execute(`${api}/webview/report/tasks/${detail.template.uid}/dataset/dsData/start`,'POST',{parameters,session:{sessionId:session.sessionId}},true))
    if(!str(result.id))throw new ReportError('Veeam ONE did not return an execution identifier. Reload before trying again.')
    return {sessionId:str(session.sessionId),executionId:str(result.id),state:str(result.state)||'Running'}
  }catch(e){await execute(`${api}/webview/sessions/finish`,'POST',{sessionId:session.sessionId},true).catch(()=>undefined);throw e}
}
export async function status(execute:Execute,run:StoredRun){
  const data=state(await execute(`${api}/webview/report/tasks/${run.executionId}/status`));if(data.resource)run.resource=data.resource
  const {resource:_,...visible}=data;void _
  run.status={...run.status,...visible};return run.status
}
export async function sectionData(execute:Execute,run:StoredRun,sectionId:string,offset:number,limit:number,order?:{id:string;direction:'asc'|'desc'}){
  const s=run.status.sections.find(s=>s.id===sectionId)
  if(!s || s.status!=='Ready' || !run.resource)throw new ReportError('This section is not ready. Refresh the execution status.',409)
  const base=`${api}/webview/report/tasks/${run.templateId}/sections/${encodeURIComponent(sectionId)}`,body={session:{sessionId:run.sessionId},resourceId:run.resource}
  let columns:{id:string;name:string}[]=[],warning:string|null=null
  try{const metadata=obj(await execute(`${base}/metadata`,'POST',body));columns=list(metadata.columns).map(obj).filter(r=>str(r.columnId)).map(r=>({id:str(r.columnId),name:str(r.columnName)||str(r.columnId)}))}catch(e){rethrowAuth(e);warning='Column metadata could not be read. Returned field names are shown.'}
  // Stable server-side ordering prevents rows from moving between pages. The full
  // column tuple also distinguishes records sharing a workload or job name.
  if(order && !columns.some(column=>column.id===order.id))throw new ReportError('This sort column is not available in the report metadata. Reset the order or refresh the section.',400)
  const ordering=[...(order?[{property:order.id,direction:order.direction==='desc'?'Descending':'Ascending'}]:[]),...columns.filter(column=>column.id!==order?.id).map(column=>({property:column.id,direction:'Ascending'}))]
  const data=pageData(await execute(`${base}/data`,'POST',{...body,query:{offset,limit,...(columns.length?{select:JSON.stringify(columns.map(c=>c.id)),sort:JSON.stringify(ordering)}:{})}}),offset,limit)
  return {...data,columns,warning:warning||data.warning}
}
export async function savedReports(execute:Execute){
  const config=obj(await execute(`${api}/configuration`)),context=str(config.userContextId)
  if(!context)throw new ReportError('Veeam ONE did not return a reporting user context.')
  const raw=obj(await execute(`${api}/folders/gridTree?userContextId=${encodeURIComponent(context)}`))
  if(!Array.isArray(raw.children))throw new ReportError('The saved-report folders could not be read.')
  return raw.children
}
