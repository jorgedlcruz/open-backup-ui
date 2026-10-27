import {createHash,randomUUID} from 'node:crypto'
import {NextRequest,NextResponse} from 'next/server'
import {cookies} from 'next/headers'
import {configStore,type VBRSource} from './config-store'
import {tokenManager} from './token-manager'
import {getChunkedCookie} from '../utils/cookie-manager'
import {ReportError,obj,str,type Row} from '../one-reports/model'
import {catalog,definition,parameterChoices,savedReports,start,status,sectionData,type Execute,type StoredRun} from '../one-reports/load'

const headers={'Cache-Control':'private, no-store'},base=(s:VBRSource)=>`${s.protocol}://${s.host}:${s.port}`
const keyOf=(s:VBRSource)=>createHash('sha256').update(JSON.stringify([s.id,base(s),s.username])).digest('hex')
const globalReports=globalThis as typeof globalThis & {oneReportRuns?:Map<string,StoredRun>}
const runs=globalReports.oneReportRuns ||= new Map<string,StoredRun>()
const validId=(id:string)=>/^\d+$|^[a-f\d]{8}-[a-f\d-]{27,36}$|^saved-\d+$/i.test(id)
export function allowedResource(path:string,method:string){
  if(path.includes('..')||path.includes('://'))return false
  const p=path.split('?')[0]
  return method==='GET'?/^\/api\/v2\.3\/(reportPacks\/(templates|tags)|reportPacks\/\d+\/templates\/\d+(\/parameters)?|reportPacks\/templates\/\d+\/link|reportPacks\/templates\/parameterTypes\/\d+\/datasource\/\d+\/parameters|resources\/\d+|reports\/\d+(\/directLink)?|configuration|folders\/gridTree|webview\/report\/tasks\/[a-f\d-]+\/status)$/.test(p):/^\/api\/v2\.3\/(reportPacks\/templates\/parameterTypes\/\d+\/datasource\/\d+\/data|webview\/sessions\/(start|finish)|webview\/report\/tasks\/[a-f\d-]+\/(dataset\/dsData\/start|sections\/[^/]+\/(data|metadata)))$/.test(p)
}
async function withReports(request:NextRequest,expected:string|null,load:(execute:Execute,source:string,key:string)=>Promise<unknown>){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000),abort=()=>controller.abort()
  let generationSent=false
  request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort()
  try{
    const jar=await cookies(),source=configStore.getById(jar.get('veeam_one_source_id')?.value||'env-one')
    if(!source||source.platform!=='one')throw new ReportError('Connect a Veeam ONE data source to browse reports.',401)
    const destination=new URL(base(source)),key=keyOf(source)
    if(!['https:','http:'].includes(destination.protocol)||destination.username||destination.password)throw new ReportError('Invalid Veeam ONE endpoint.',400)
    if(expected&&expected!==key)throw new ReportError('The selected Veeam ONE source changed. Reload this page before continuing.',409)
    const ensure=()=>{const current=configStore.getById(source.id);if(!current||current.platform!=='one'||keyOf(current)!==key||current.password!==source.password)throw new ReportError('The data source changed. Reload and reconnect before continuing.',409)}
    const cached=tokenManager.peek(source.id);let token=cached&&cached.expiresAt>Date.now()/1000?cached.accessToken:null
    if(!token){try{if(new URL(jar.get('veeam_one_token_url')?.value||'').origin===destination.origin)token=getChunkedCookie(jar,'veeam_one_token')||null}catch{}}
    let authentication:Promise<string>|null=null
    const authenticate=()=>authentication ||= (async()=>{
      ensure();if(!source.username||!source.password)throw new ReportError('Reconnect this Veeam ONE data source to renew its session.',401)
      const response=await fetch(new URL('/api/token',destination),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'password',username:source.username,password:source.password}),signal:controller.signal,redirect:'error',cache:'no-store'})
      if(!response.ok)throw new ReportError('Veeam ONE authentication was not accepted. Reconnect this data source.',401)
      const data=await response.json();ensure();if(typeof data.access_token!=='string'||!data.access_token)throw new ReportError('Veeam ONE did not return a valid session.')
      tokenManager.remember(source.id,data.access_token,typeof data.expires_in==='number'?data.expires_in:null);return data.access_token as string
    })()
    if(!token)token=await authenticate()
    const execute:Execute=async(path,method='GET',body,once=false)=>{
      if(!allowedResource(path,method))throw new ReportError('Invalid report resource.',400)
      const send=()=>{ensure();if(path.endsWith('/dataset/dsData/start'))generationSent=true;return fetch(new URL(path,destination),{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:controller.signal,redirect:'error',cache:'no-store'})}
      let response=await send()
      // Read-only parameter and section POSTs may renew authentication. Generation is never replayed.
      if(response.status===401&&!once){token=await authenticate();response=await send()}
      if(!response.ok)throw new ReportError(response.status===401?'Your reporting session expired. Reconnect and reload before retrying.':response.status===403?'This account does not have permission for this report.':`Veeam ONE could not complete the report request (HTTP ${response.status}).${once?' Reload before starting another execution.':''}`,[400,401,403,404,409].includes(response.status)?response.status:502)
      ensure();const text=await response.text();return text?JSON.parse(text):null
    }
    return NextResponse.json(await load(execute,source.name||source.host,key),{headers})
  }catch(e){return NextResponse.json({error:e instanceof ReportError?e.message:generationSent?'The execution outcome could not be confirmed. Check the report in Veeam ONE before starting another run.':controller.signal.aborted?'The report request timed out. Refresh execution status before starting again.':'Report data could not be read. Check the connection and retry.'},{status:e instanceof ReportError?e.status:controller.signal.aborted?504:502,headers})}
  finally{clearTimeout(timer);controller.abort();request.signal.removeEventListener('abort',abort)}
}
const invalid=()=>NextResponse.json({error:'Invalid report request.'},{status:400,headers})
function runFor(id:string,key:string){const run=runs.get(id);if(!run||run.expires<Date.now())throw new ReportError('This report session expired. Run the report again.',410);if(run.key!==key)throw new ReportError('This execution belongs to a different Veeam ONE source.',409);return run}
export async function readReports(request:NextRequest){
  const p=request.nextUrl.searchParams,mode=p.get('mode')||'catalog',expected=p.get('sourceKey'),id=p.get('id')||''
  if(expected&&!/^[a-f\d]{64}$/.test(expected)||!['catalog','saved','definition','status','section'].includes(mode))return invalid()
  if(['definition','status','section'].includes(mode)&&!expected)return invalid()
  if(mode==='definition'&&!validId(id))return invalid()
  const offset=Number(p.get('offset')||0),limit=Number(p.get('limit')||50)
  if(!Number.isSafeInteger(offset)||offset<0||offset>10000000||!Number.isSafeInteger(limit)||limit<1||limit>500)return invalid()
  const sortField=p.get('sortField'),direction=p.get('sortDirection')
  if(sortField!==null && (!sortField || sortField.length>512 || !['asc','desc'].includes(direction||'')) || sortField===null && direction!==null)return invalid()
  return withReports(request,expected,async(execute,source,key)=>{
    if(mode==='catalog')return {source,sourceKey:key,...await catalog(execute)}
    if(mode==='saved')return {source,sourceKey:key,children:await savedReports(execute)}
    if(mode==='definition')return {source,sourceKey:key,...await definition(execute,id)}
    const run=runFor(p.get('runId')||'',key)
    if(mode==='status')return status(execute,run)
    return sectionData(execute,run,p.get('section')||'',offset,limit,sortField?{id:sortField,direction:direction as 'asc'|'desc'}:undefined)
  })
}
export async function writeReports(request:NextRequest){
  if(request.headers.get('origin')&&request.headers.get('origin')!==request.nextUrl.origin||request.headers.get('sec-fetch-site')==='cross-site')return NextResponse.json({error:'Report operations must originate from this application.'},{status:403,headers})
  const raw=await request.text();if(raw.length>150000)return invalid()
  let input:Row;try{input=obj(JSON.parse(raw))}catch{return invalid()}
  const expected=str(input.sourceKey),id=str(input.id),action=str(input.action)
  if(!/^[a-f\d]{64}$/.test(expected)||!['start','choices','finish'].includes(action)||action!=='finish'&&!validId(id))return invalid()
  return withReports(request,expected,async(execute,_source,key)=>{
    if(action==='finish'){const run=runFor(str(input.runId),key);await execute('/api/v2.3/webview/sessions/finish','POST',{sessionId:run.sessionId},true);runs.delete(run.status.runId);return {finished:true}}
    const detail=await definition(execute,id,false)
    if(action==='choices')return parameterChoices(execute,detail,str(input.parameter),obj(input.values))
    for(const [id,run] of runs)if(run.expires<Date.now())runs.delete(id)
    if(runs.size>=100)throw new ReportError('The report session limit has been reached. Close an existing report session first.',429)
    const execution=await start(execute,detail,obj(input.values)),runId=randomUUID(),started=new Date().toISOString()
    const run:StoredRun={key,templateId:detail.template.uid,sessionId:execution.sessionId,executionId:execution.executionId,definition:detail,resource:'',expires:Date.now()+3600000,status:{runId,state:execution.state,sections:[],created:'',started,error:null,resourceStatus:'',nested:[]}}
    runs.set(runId,run);return run.status
  })
}
