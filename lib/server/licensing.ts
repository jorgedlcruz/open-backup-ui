// Open Backup UI v1.3.0
import { fetchVbrCompatible } from '../vbr/compatible-fetch'
import { NextRequest,NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { configStore } from './config-store'
import { tokenManager } from './token-manager'
import { getChunkedCookie } from '../utils/cookie-manager'
import { endpoint, sessionKeys } from '../data-sources/model'
import { isSameApplicationOrigin } from './request-origin'
import { VbmRequestError } from '../vbm-dashboard/load'
import { loadVbr,loadVbm } from '../licensing/load'
import { operation,type Operation } from '../licensing/actions'
import { type Platform } from '../licensing/model'

type Execute=(path:string,method?:'GET'|'POST'|'DELETE',body?:unknown,format?:'json'|'accepted'|'html'|'pdf')=>Promise<unknown>
const privateHeaders={'Cache-Control':'private, no-store'}

async function licensingConnection(request:NextRequest, platform:Platform) {
  const jar=await cookies(), kind=platform==='vbr'?'vbr':'vb365'
  const {id:sourceKey,token:tokenKey}=sessionKeys[kind]
  const selected=jar.get(sourceKey)?.value
  const saved=configStore.getAll().filter(source=>source.platform===kind)
  const environment=configStore.getById(`env-${kind}`)
  const configured=environment ? [...saved,environment] : saved
  const sourceUrl=(source:typeof saved[number])=>endpoint(`${source.protocol}://${source.host}:${source.port}`).url
  const cookieToken=getChunkedCookie(jar,tokenKey)
  const bearer=request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
  const tokenUrl=jar.get(tokenKey+'_url')?.value
  let tokenOrigin:string|undefined
  if((cookieToken || bearer) && tokenUrl) {
    try { tokenOrigin=endpoint(tokenUrl).url } catch { /* A malformed session binding cannot supply a token. */ }
  }
  const legacySelection=!selected && !!cookieToken && !!tokenUrl
  const source=selected ? configStore.getById(selected)
    : legacySelection ? configured.find(item=>sourceUrl(item)===tokenOrigin) : configured[0]
  if(selected && source?.platform!==kind)throw new VbmRequestError('Select a valid data source for this platform.',400)
  if(legacySelection && !source)throw new VbmRequestError('Your session has expired. Reconnect this data source.',401)
  if(!source)throw new VbmRequestError(`Connect ${platform==='vbr' ? 'VBR':'Microsoft 365'} to view licensing.`,400)
  const destination=new URL(sourceUrl(source))
  // A legacy URL can select a configured endpoint. Keep the caller's token and principal for that session.
  const managedToken=legacySelection ? null : await tokenManager.getToken(source.id)
  // Legacy environment logins may have a bearer without a URL binding. Only the server's
  // environment origin can receive it; selecting a saved host cannot redirect that bearer.
  const environmentMatches=!!environment && sourceUrl(environment)===destination.origin
  const originMatches=!tokenUrl || tokenOrigin===destination.origin
  const canUseBrowserToken=originMatches && (!!cookieToken && !!tokenUrl || environmentMatches)
  const token=managedToken || (canUseBrowserToken && (cookieToken || bearer)) || null
  if(!token)throw new VbmRequestError('Your session has expired. Reconnect this data source.',401)
  return {destination,token,managedId:managedToken ? source.id : undefined}
}

async function sourceRequest(request:NextRequest,platform:Platform,load:(execute:Execute,source:string)=>Promise<unknown|NextResponse>) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000),abort=()=>controller.abort()
  request.signal.addEventListener('abort',abort,{once:true})
  try {
    const {destination,token:initialToken,managedId}=await licensingConnection(request,platform)
    let token=initialToken
    let refresh:Promise<string|null>|null=null,revision='1.3-rev2'
    const execute:Execute=async(path,method='GET',body,format='json')=>{
      if(!(platform==='vbr' ? path.startsWith('/api/v1/license'):path.startsWith('/v8/License') || path.startsWith('/v8/Reports/GenerateLicenseOverview')) || path.includes('://'))throw new VbmRequestError('Invalid licensing resource.',400)
      const send=()=>fetchVbrCompatible(new URL(path,destination),{method,headers:{Authorization:`Bearer ${token}`,Accept:format==='html' || format==='pdf' ? 'application/octet-stream':'application/json',...(platform==='vbr' ? {'x-api-version':method==='GET' ? revision:'1.3-rev1'}:{}),...(body!==undefined ? {'Content-Type':'application/json'}:{})},...(body!==undefined ? {body:JSON.stringify(body)}:{}),signal:controller.signal,redirect:'error',cache:'no-store'})
      let response=await send()
      // Only retry a read with the older revision; mutations are never replayed for API-version negotiation.
      if(platform==='vbr' && method==='GET' && [400,406].includes(response.status)){revision='1.3-rev1';response=await send()}
      if(response.status===401 && managedId){refresh ||= tokenManager.refreshToken(managedId);const fresh=await refresh;if(fresh){token=fresh;response=await send()}}
      if(!response.ok){
        let code=''
        try {const failure=await response.json();if(typeof failure.errorCode==='string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(failure.errorCode))code=` · ${failure.errorCode}`}catch{/* Source messages and stack traces are deliberately excluded. */}
        throw new VbmRequestError(response.status===401 ? 'Your session has expired. Reconnect this data source.':response.status===403 ? 'Your account does not have permission for this licensing operation.':`The source could not complete the licensing ${method==='GET' ? 'read':'request'} (HTTP ${response.status}${code}).`,[401,403].includes(response.status) ? response.status:502)
      }
      if(format==='accepted')return {accepted:true}
      if(format==='html'){const report=await response.text();if(!/^\s*(?:<!doctype\s+html|<html)[\s>]/i.test(report))throw new VbmRequestError('The source did not return an HTML license report.',502);return new NextResponse(report,{headers:{...privateHeaders,'Content-Type':'text/html; charset=utf-8','Content-Disposition':'attachment; filename="Veeam_VBR_License_Report.html"'}})}
      if(format==='pdf'){const report=await response.arrayBuffer();if(new TextDecoder().decode(report.slice(0,5))!=='%PDF-')throw new VbmRequestError('The source did not return a PDF license report.',502);return new NextResponse(report,{headers:{...privateHeaders,'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="Veeam_M365_License_Report.pdf"'}})}
      return response.json()
    }
    const result=await load(execute,destination.hostname)
    return result instanceof NextResponse ? result:NextResponse.json(result,{headers:privateHeaders})
  }catch(error){return NextResponse.json({error:error instanceof VbmRequestError ? error.message:controller.signal.aborted ? 'The licensing request timed out. Refresh to retry.':'Licensing data could not be processed. Check the connection and refresh.'},{status:error instanceof VbmRequestError ? error.status:controller.signal.aborted ? 504:502,headers:privateHeaders})}
  finally{clearTimeout(timer);controller.abort();request.signal.removeEventListener('abort',abort)}
}
export function readLicensing(request:NextRequest,platform:Platform) {return sourceRequest(request,platform,(execute,name)=>platform==='vbr' ? loadVbr(path=>execute(path),name):loadVbm(path=>execute(path),name))}
export function mutateLicensing(request:NextRequest,platform:Platform,action:'revoke'|'report',input:unknown) {
  if(!isSameApplicationOrigin(request) || request.headers.get('sec-fetch-site')==='cross-site')return Promise.resolve(NextResponse.json({error:'Licensing actions must originate from this application.'},{status:403,headers:privateHeaders}))
  let op:Operation
  try {op=operation(platform,action,input)}catch{return Promise.resolve(NextResponse.json({error:'Invalid licensing request or report dates.'},{status:400,headers:privateHeaders}))}
  return sourceRequest(request,platform,execute=>execute(op.path,op.method,op.body,op.format))
}
