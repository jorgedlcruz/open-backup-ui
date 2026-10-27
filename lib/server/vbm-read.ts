import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { configStore } from './config-store'
import { tokenManager } from './token-manager'
import { getVB365Config, refreshVB365Token } from './vb365-helper'
import { VbmRequestError, type Reader } from '../vbm-dashboard/load'
import { actionPath, type JobAction } from '../vbm-jobs/model'
import { proxyAction } from '../vbm-proxies/actions'
import { readCacheScope } from './read-cache-scope'

export async function withVbmRead(request:NextRequest, load:(read:Reader,source:string,context:{cacheKey:string})=>Promise<unknown>) {
  return withVbmSource(request,(execute,source,context)=>load(path=>execute(path,'GET'),source,context))
}

export async function withVbmJobAction(request:NextRequest,id:string,action:JobAction) {
  const origin=request.headers.get('origin')
  if(origin && origin!==request.nextUrl.origin)return NextResponse.json({error:'Job actions must originate from this application.'},{status:403})
  let path:string
  try {path=actionPath(id,action)}catch{return NextResponse.json({error:'Invalid job action.'},{status:400})}
  return withVbmSource(request,async execute=>{await execute(path,'POST');return {accepted:true}})
}

export async function withVbmProxyAction(request:NextRequest,id:string,action:unknown,credentials?:unknown) {
  const origin=request.headers.get('origin')
  if(origin && origin!==request.nextUrl.origin)return NextResponse.json({error:'Proxy actions must originate from this application.'},{status:403})
  let operation:ReturnType<typeof proxyAction>
  try {operation=proxyAction(id,action,credentials)}catch{return NextResponse.json({error:'Invalid proxy action or missing maintenance credentials.'},{status:400})}
  return withVbmSource(request,async execute=>{await execute(operation.path,'POST',operation.body);return {accepted:true}})
}

async function withVbmSource(request:NextRequest, load:(execute:(path:string,method:'GET'|'POST',body?:unknown)=>Promise<unknown>,source:string,context:{cacheKey:string})=>Promise<unknown>) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000),abort=()=>controller.abort()
  request.signal.addEventListener('abort',abort,{once:true})
  const headers={'Cache-Control':'private, no-store'}
  try {
    const sourceId=(await cookies()).get('veeam_vb365_source_id')?.value
    const resolvedId=sourceId || configStore.getAll().find(source=>source.platform==='vb365')?.id
    const source=resolvedId ? configStore.getById(resolvedId) : null
    if(sourceId && (!source || source.platform!=='vb365'))throw new VbmRequestError('Select a valid Microsoft 365 data source.',400)
    // Destinations come from saved configuration or the server environment, never a URL query parameter.
    const baseUrl=source ? `${source.protocol}://${source.host}:${source.port}` : process.env.VBM_API_URL
    if(!baseUrl)throw new VbmRequestError('Connect a Microsoft 365 data source first.',400)
    const fallback=source ? null : await getVB365Config()
    let token=source ? await tokenManager.getToken(source.id) : fallback && new URL(fallback.baseUrl).origin===new URL(baseUrl).origin ? fallback.token : null
    if(!token)throw new VbmRequestError('Your Microsoft 365 session has expired. Reconnect your data source.',401)
    const destination=new URL(baseUrl)
    if(!['http:','https:'].includes(destination.protocol))throw new VbmRequestError('Invalid source protocol.',400)
    let refreshing:Promise<string|null>|null=null
    const execute=async (path:string,method:'GET'|'POST',body?:unknown)=>{
      if(!path.startsWith('/v8/') || path.includes('://'))throw new VbmRequestError('Unsupported dashboard resource.',400)
      const send=()=>fetch(new URL(path,destination),{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(method==='POST' ? {'Content-Type':'application/json'}:{})},...(method==='POST' ? {body:JSON.stringify(body ?? {})}:{}),cache:'no-store',redirect:'error',signal:controller.signal})
      let response=await send()
      if(response.status===401){refreshing ||= source ? tokenManager.refreshToken(source.id) : refreshVB365Token();token=await refreshing;if(token)response=await send()}
      if(!response.ok)throw new VbmRequestError(response.status===401 ? 'Your Microsoft 365 session has expired. Reconnect your data source.' : method==='POST' ? `The Microsoft 365 source rejected the action (HTTP ${response.status}). Check permissions, credentials and proxy availability.` : 'The Microsoft 365 source could not return these records.',[401,403].includes(response.status) ? response.status : 502)
      if(method==='POST')return {accepted:true}
      return response.json()
    }
    return NextResponse.json(await load(execute,source?.host || destination.hostname,{cacheKey:readCacheScope(destination.href,token,source || undefined)}),{headers})
  }catch(error){return NextResponse.json({error:error instanceof VbmRequestError ? error.message : controller.signal.aborted ? 'Loading took too long. Refresh to retry.' : 'Microsoft 365 dashboard data could not be loaded.'},{status:error instanceof VbmRequestError ? error.status : controller.signal.aborted ? 504 : 502,headers})}
  finally{clearTimeout(timer);controller.abort();request.signal.removeEventListener('abort',abort)}
}
