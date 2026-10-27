import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { configStore, type VBRSource } from './config-store'
import { tokenManager } from './token-manager'
import { getChunkedCookie, setChunkedCookie, deleteChunkedCookie } from '../utils/cookie-manager'
import { connectInput, editInput, endpoint, normalizePlatform, sourceId, sourceInput, unchecked, type Source, type Row, type Platform } from '../data-sources/model'
import { probe } from '../data-sources/probe'
import { isSameApplicationOrigin, isSecureApplicationRequest } from './request-origin'

const headers = {'Cache-Control':'private, no-store'}
type Jar = Awaited<ReturnType<typeof cookies>>
export const sessionKeys: Record<Platform,{id:string;token:string}> = {
  vbr:{id:'veeam_source_id',token:'veeam_vbr_token'}, vb365:{id:'veeam_vb365_source_id',token:'veeam_vb365_token'},
  vro:{id:'veeam_vro_source_id',token:'veeam_vro_token'}, one:{id:'veeam_one_source_id',token:'veeam_one_token'}, kasten:{id:'veeam_kasten_source_id',token:'kasten_token'},
}
class SourceError extends Error { constructor(message:string, public status=400){super(message)} }
function safeError(error:unknown) { return NextResponse.json({error:error instanceof SourceError ? error.message:'The data-source request could not be completed. Check the connection details and try again.'},{status:error instanceof SourceError ? error.status:502,headers}) }
function sameOrigin(request:NextRequest) { if(!isSameApplicationOrigin(request))throw new SourceError('Data-source changes must originate from this application.',403) }
function sourceUrl(source:VBRSource) { return endpoint(`${source.protocol}://${source.host}:${source.port}`).url }
function selected(source:Pick<Source,'id'|'type'|'url'>, jar:Jar) {
  const keys=sessionKeys[source.type], id=jar.get(keys.id)?.value
  if(id)return id===source.id
  const url=jar.get(`${keys.token}_url`)?.value
  try {return !!getChunkedCookie(jar,keys.token) && !!url && endpoint(url).url===source.url}catch{return false}
}
export function catalog(jar:Jar):Source[] {
  const stored=configStore.getAll(), all=[...stored]
  for(const id of ['env-vbr','env-vb365','env-one','env-vro']) {
    const source=configStore.getById(id)
    if(source && !all.some(row=>row.platform===source.platform && sourceUrl(row)===sourceUrl(source))) all.push(source)
  }
  return all.map(source=>{
    const type=normalizePlatform(source.platform),url=sourceUrl(source)
    const row:Source={id:source.id,type,name:source.name || url,url,username:source.username || '',hasCredentials:!!source.hasCredentials || !!source.password,managed:source.id.startsWith('env-') ? 'environment':'saved',selected:false}
    row.selected=selected(row,jar); return row
  })
}
export async function sourcesForClient() {
  const jar=await cookies()
  return catalog(jar).map(row=>({...row,isAuthenticated:row.selected}))
}
function resolve(id:string) {
  if(!sourceId.safeParse(id).success)throw new SourceError('Invalid data-source ID.')
  const source=configStore.getById(id)
  if(!source)throw new SourceError('This data source no longer exists. Refresh the list.',404)
  return source
}
function transportSignal(request:NextRequest) { return AbortSignal.any([request.signal,AbortSignal.timeout(15000)]) }
function sameConnection(a:VBRSource,b:VBRSource) {
  return a.platform===b.platform && a.host===b.host && a.port===b.port && a.protocol===b.protocol && a.username===b.username && a.password===b.password
}
async function check(source:Source,jar:Jar,request:NextRequest):Promise<Row> {
  if(source.type==='kasten')return {...source,health:await probe(source.type,async()=>{throw Error('unsupported')},false)}
  const original=resolve(source.id)
  if(sourceUrl(original)!==source.url || normalizePlatform(original.platform)!==source.type)throw new SourceError('Configuration changed during the check. Refresh to retry.',409)
  const keys=sessionKeys[source.type]
  let token:string|null=null
  let authFailure:SourceError|null=null
  if(source.type==='vbr' || source.type==='vb365') token=await tokenManager.getToken(source.id)
  else { const cached=tokenManager.peek(source.id); if(cached && cached.expiresAt>Date.now()/1000)token=cached.accessToken }
  if(!token && source.selected)token=getChunkedCookie(jar,keys.token) || null
  if(!token && source.hasCredentials && (source.type==='one' || source.type==='vro')) {
    try {const login=await authenticateSource(original,request);if(!sameConnection(original,resolve(source.id)))throw new SourceError('Configuration changed during authentication. Refresh to retry.',409);token=login.token;tokenManager.remember(source.id,token,login.expiresIn)}
    catch(error){if(error instanceof SourceError)authFailure=error}
  }
  if(!sameConnection(original,resolve(source.id)))throw new SourceError('Configuration changed during the check. Refresh to retry.',409)
  const health=await probe(source.type,async(path,revision,authenticated)=>fetch(new URL(path,source.url),{
    headers:{Accept:'application/json',...(authenticated && token ? {Authorization:`Bearer ${token}`} : {}),...(source.type==='vbr' ? {'x-api-version':revision}:{})},
    signal:transportSignal(request),redirect:'error',cache:'no-store',
  }),!!token)
  if(authFailure && health.authentication!=='verified') {
    if(authFailure.status===401)health.authentication='rejected'
    else if(authFailure.status===403)health.authentication='forbidden'
    health.detail=`${health.detail} ${authFailure.message}`
  }
  const cached=tokenManager.peek(source.id)
  health.tokenExpiresAt=cached?.expiryReported ? new Date(cached.expiresAt*1000).toISOString():null
  health.lastAuthenticated=cached?.authenticatedAt ? new Date(cached.authenticatedAt*1000).toISOString():null
  return {...source,health}
}
export async function readSources(request:NextRequest) {
  try {
    const jar=await cookies(), all=catalog(jar), id=request.nextUrl.searchParams.get('id')
    if(id && !all.some(row=>row.id===id))throw new SourceError('Data source not found.',404)
    const wanted=id ? all.filter(row=>row.id===id):all, results:Row[]=new Array(wanted.length)
    let next=0
    await Promise.all(Array.from({length:Math.min(4,wanted.length)},async()=>{
      while(next<wanted.length){
        const index=next++,row=wanted[index]
        try {results[index]=request.nextUrl.searchParams.get('check')==='1' ? await check(row,jar,request):{...row,health:unchecked(row.type)}}
        catch {results[index]={...row,health:{...unchecked(row.type),detail:'The connection check could not complete. Retry this source.'}}}
      }
    }))
    return NextResponse.json({sources:results,fetchedAt:new Date().toISOString()},{headers})
  }catch(error){return safeError(error)}
}
async function clearSession(source:Source,jar:Jar) {
  if(!selected(source,jar))return
  const keys=sessionKeys[source.type]
  jar.delete(keys.id);jar.delete(`${keys.token}_url`);await deleteChunkedCookie(jar,keys.token)
}
async function bindSession(source:VBRSource,token:string,jar:Jar,request:NextRequest) {
  const type=normalizePlatform(source.platform),keys=sessionKeys[type],options={httpOnly:true,secure:isSecureApplicationRequest(request),sameSite:'lax' as const,path:'/',maxAge:604800}
  jar.set(keys.id,source.id,options);jar.set(`${keys.token}_url`,sourceUrl(source),options)
  if(type==='vbr' || type==='vb365')await deleteChunkedCookie(jar,keys.token)
  else await setChunkedCookie(jar,keys.token,token,{...options,maxAge:28800})
}
export async function authenticateSource(source:VBRSource,request:NextRequest) {
  const type=normalizePlatform(source.platform),path=type==='vb365' ? '/v7/Token':type==='one' ? '/api/token':type==='kasten' ? '/api/v1/auth':'/api/oauth2/token'
  if(!source.username || !source.password)throw new SourceError('Enter a username and password to connect this source.',401)
  const response=await fetch(new URL(path,sourceUrl(source)),{
    method:'POST',headers:{Accept:'application/json','Content-Type':type==='kasten' ? 'application/json':'application/x-www-form-urlencoded',...(type==='vbr' ? {'x-api-version':'1.3-rev1'}:{})},
    body:type==='kasten' ? JSON.stringify({username:source.username,password:source.password}):new URLSearchParams({grant_type:'password',username:source.username,password:source.password}),
    redirect:'error',cache:'no-store',signal:transportSignal(request),
  })
  if(!response.ok)throw new SourceError(`Authentication was not accepted (HTTP ${response.status}). Check credentials, permissions and any MFA requirements.`,[401,403].includes(response.status) ? response.status:502)
  const data=await response.json(),token=data.access_token || data.token || data.accessToken
  if(typeof token!=='string' || !token || token.length>60000)throw new SourceError('The source did not return an authentication token.',502)
  const expiresIn=typeof data.expires_in==='number' && Number.isFinite(data.expires_in) && data.expires_in>0 ? data.expires_in:null
  return {token,expiresIn}
}
export async function mutateSource(request:NextRequest,action:'add'|'edit'|'remove'|'connect'|'disconnect',id?:string) {
  try {
    sameOrigin(request)
    const jar=await cookies(), body=action==='remove' || action==='disconnect' ? {}:await request.json()
    if(action==='add') {
      const parsed=sourceInput.safeParse(body);if(!parsed.success)throw new SourceError('Enter a valid platform, display name and server URL.')
      const value=parsed.data
      if(catalog(jar).some(row=>row.type===value.type && row.url===value.url.url))throw new SourceError('This platform and endpoint are already configured.',409)
      const source:VBRSource={id:`ds-${randomUUID()}`,platform:value.type,name:value.name,host:value.url.host,port:value.url.port,protocol:value.url.protocol,username:''}
      configStore.save(source);return NextResponse.json({success:true,id:source.id},{status:201,headers})
    }
    const original=resolve(id || ''),type=normalizePlatform(original.platform),row=catalog(jar).find(row=>row.id===original.id) || {id:original.id,type,url:sourceUrl(original),selected:false} as Source
    if(action==='disconnect') {await clearSession(row,jar);return NextResponse.json({success:true},{headers})}
    if((action==='edit' || action==='remove') && original.id.startsWith('env-'))throw new SourceError('This source is managed by environment configuration. Update it on the server.',409)
    if(action==='remove') {configStore.delete(original.id);tokenManager.forget(original.id);await clearSession(row,jar);return NextResponse.json({success:true},{headers})}
    if(action==='edit') {
      const parsed=editInput.safeParse(body);if(!parsed.success)throw new SourceError('Enter a valid display name and server URL.')
      const value=parsed.data,changed=value.url.url!==sourceUrl(original)
      if(catalog(jar).some(other=>other.id!==original.id && other.type===type && other.url===value.url.url))throw new SourceError('This platform and endpoint are already configured.',409)
      configStore.save({...original,name:value.name,host:value.url.host,port:value.url.port,protocol:value.url.protocol,...(changed ? {password:undefined,username:''}:{})})
      if(changed){tokenManager.forget(original.id);await clearSession(row,jar)}
      return NextResponse.json({success:true,requiresAuthentication:changed},{headers})
    }
    const parsed=connectInput.safeParse(body);if(!parsed.success)throw new SourceError('Provide both a username and password, or use the saved credentials.')
    if(original.id.startsWith('env-') && parsed.data.password)throw new SourceError('Environment credentials must be updated on the server.',409)
    const candidate={...original,...parsed.data},result=await authenticateSource(candidate,request),current=resolve(original.id)
    if(!sameConnection(original,current))throw new SourceError('This source changed during authentication. Refresh and reconnect.',409)
    // Failed sign-ins cannot overwrite or remove the saved configuration.
    if(parsed.data.password)configStore.save({...current,...parsed.data})
    tokenManager.remember(original.id,result.token,result.expiresIn)
    await bindSession(candidate,result.token,jar,request)
    return NextResponse.json({success:true,id:original.id},{headers})
  }catch(error){return safeError(error)}
}
