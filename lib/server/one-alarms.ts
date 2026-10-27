import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { configStore, type VBRSource } from './config-store'
import { tokenManager } from './token-manager'
import { getChunkedCookie } from '../utils/cookie-manager'
import { AlarmError, apiFilter, loadDetail, loadOverview, resolveAlarm, resolveSchema, type Execute } from '../one-alarms/load'
import { filtersSchema } from '../one-alarms/model'

const headers = { 'Cache-Control': 'private, no-store' }
const baseUrl = (source: VBRSource) => `${source.protocol}://${source.host}:${source.port}`
const sourceKey = (source: VBRSource) => createHash('sha256').update(JSON.stringify([source.id,baseUrl(source),source.username])).digest('hex')
const sameSource = (a: VBRSource, b: VBRSource | null) => !!b && b.platform === 'one' && sourceKey(a) === sourceKey(b) && a.password === b.password

async function withAlarms(request: NextRequest, load: (execute: Execute, name: string, key: string) => Promise<unknown>, expected?: string) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(),60000)
  const abort = () => controller.abort(); request.signal.addEventListener('abort',abort,{once:true}); if(request.signal.aborted)abort()
  let mutationSent = false
  try {
    const jar = await cookies(), selected = jar.get('veeam_one_source_id')?.value
    const source = configStore.getById(selected || 'env-one')
    if(!source || source.platform !== 'one')throw new AlarmError('Connect a Veeam ONE data source to inspect alarms.',401)
    const destination = new URL(baseUrl(source)), key = sourceKey(source)
    if(!['https:','http:'].includes(destination.protocol) || destination.username || destination.password)throw new AlarmError('Invalid Veeam ONE endpoint.',400)
    if(expected && expected !== key)throw new AlarmError('The selected Veeam ONE source changed. Refresh before continuing.',409)
    const ensureSource = () => { if(!sameSource(source,configStore.getById(source.id)))throw new AlarmError('The data source changed. Refresh and reconnect before continuing.',409) }
    const cached = tokenManager.peek(source.id)
    let token = cached && cached.expiresAt > Date.now()/1000 ? cached.accessToken : null
    const cookieUrl = jar.get('veeam_one_token_url')?.value
    if(!token && cookieUrl) {
      try { if(new URL(cookieUrl).origin === destination.origin)token=getChunkedCookie(jar,'veeam_one_token') || null } catch { /* Malformed cookie cannot select a destination. */ }
    }
    let authentication: Promise<string> | null = null
    const authenticate = () => authentication ||= (async() => {
      ensureSource()
      if(!source.username || !source.password)throw new AlarmError('Your Veeam ONE session expired. Reconnect this data source.',401)
      const response = await fetch(new URL('/api/token',destination), {method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'password',username:source.username,password:source.password}),signal:controller.signal,redirect:'error',cache:'no-store'})
      if(!response.ok)throw new AlarmError('Veeam ONE authentication was not accepted. Reconnect this data source.',response.status===403 ? 403:401)
      const data = await response.json(); ensureSource()
      if(typeof data.access_token !== 'string' || !data.access_token || data.access_token.length>60000)throw new AlarmError('Veeam ONE did not return a valid session.',502)
      tokenManager.remember(source.id,data.access_token,typeof data.expires_in==='number' ? data.expires_in:null)
      return data.access_token as string
    })()
    if(!token)token=await authenticate()
    const execute: Execute = async(path,method='GET',body,mutation=false) => {
      const resource = path.split('?')[0]
      const readQuery = /^\/api\/v2\.3\/alarms\/(triggeredChildAlarms|triggeredAlarmsHistory)$/.test(resource)
      const template = /^\/api\/v2\.3\/alarms\/templates\/\d+$/.test(resource)
      const resolve = resource === '/api/v2.3/alarms/triggeredChildAlarms/resolve'
      if(!(readQuery && !mutation || template && method==='GET' && !mutation || resolve && method==='POST' && mutation) || path.includes('..') || path.includes('://'))throw new AlarmError('Invalid alarm resource.',400)
      const send = () => { ensureSource(); if(mutation)mutationSent=true; return fetch(new URL(path,destination), {method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(body!==undefined ? {'Content-Type':'application/json'}:{})},...(body!==undefined ? {body:JSON.stringify(body)}:{}),signal:controller.signal,redirect:'error',cache:'no-store'}) }
      let response = await send()
      // The two POST query resources are reads. Resolution is never replayed.
      if(response.status===401 && !mutation) {token=await authenticate();response=await send()}
      if(!response.ok)throw new AlarmError(response.status===401 ? 'Your Veeam ONE session expired. Reconnect this data source.' : response.status===403 ? 'This account does not have permission for this alarm operation.' : `Veeam ONE could not complete the ${mutation ? 'resolution. Refresh the alarm before retrying' : 'alarm read'} (HTTP ${response.status}).`,[400,401,403,404,405,409].includes(response.status) ? response.status:502)
      ensureSource()
      return mutation ? {accepted:true}:response.json()
    }
    return NextResponse.json(await load(execute,source.name || source.host,key),{headers})
  } catch(error) {
    return NextResponse.json({error: mutationSent ? 'The resolution outcome could not be confirmed. Refresh the alarm before retrying.' : error instanceof AlarmError ? error.message : controller.signal.aborted ? 'Alarm loading timed out. Refresh to retry.' : 'Alarm data could not be read. Check the connection and refresh.'},{status:error instanceof AlarmError ? error.status:controller.signal.aborted ? 504:502,headers})
  } finally {clearTimeout(timer);controller.abort();request.signal.removeEventListener('abort',abort)}
}
function invalid() { return NextResponse.json({error:'Invalid alarm filters or identifiers.'},{status:400,headers}) }
export async function readAlarms(request: NextRequest) {
  const params=request.nextUrl.searchParams, expected=params.get('sourceKey') || undefined
  if(expected && !/^[a-f0-9]{64}$/.test(expected))return invalid()
  if(params.get('detail')==='1') {
    const parent=Number(params.get('parent')),child=Number(params.get('child')),template=params.has('template') ? Number(params.get('template')):null
    if(!expected || !Number.isSafeInteger(parent) || parent<=0 || !Number.isSafeInteger(child) || child<=0 || template!==null && (!Number.isSafeInteger(template) || template<0))return invalid()
    return withAlarms(request,(execute,_name,key)=>loadDetail(execute,template,parent,child,key),expected)
  }
  try {
    const filters=filtersSchema.parse(JSON.parse(params.get('filters') || '{}')),page=Number(params.get('page') || 0)
    if(!Number.isSafeInteger(page) || page<0 || page>100000) return invalid()
    for(const date of [filters.from,filters.to])if(date && (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date))return invalid()
    if(filters.from && filters.to && filters.from>filters.to)return invalid()
    apiFilter(filters,Date.now()) // Validate composite filters before making requests.
    return withAlarms(request,(execute,name,key)=>loadOverview(execute,filters,page,name,key),expected)
  } catch {return invalid()}
}
export async function mutateAlarms(request: NextRequest) {
  const origin=request.headers.get('origin')
  if(origin && origin!==request.nextUrl.origin || request.headers.get('sec-fetch-site')==='cross-site')return NextResponse.json({error:'Alarm changes must originate from this application.'},{status:403,headers})
  const input=resolveSchema.safeParse(await request.json().catch(()=>null))
  if(!input.success)return invalid()
  return withAlarms(request,execute=>resolveAlarm(execute,input.data),input.data.sourceKey)
}
