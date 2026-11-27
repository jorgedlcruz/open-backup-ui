// Open Backup UI v1.3.0
import { after, NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ZodError } from 'zod'
import { configStore } from './config-store'
import { tokenManager } from './token-manager'
import { getVB365Config, refreshVB365Token } from './vb365-helper'
import { readCacheScope } from './read-cache-scope'
import { applicationOrigin } from './request-origin'
import { recoveryTransport, assertRecoveryOrigin } from '../vbm-recovery/transport'
import { beginBrowseSession, recoveryGet, recoveryPost, type BrowseTiming } from '../vbm-recovery/load'
import { record, RecoveryError, isRecoveryError } from '../vbm-recovery/model'
import { browseCollectionNotFound } from '../vbm-recovery/read-retry'
import { viewContent } from '../vbm-recovery/content'
import { getChunkedCookie } from '../utils/cookie-manager'

export async function handleVbmRecovery(request:NextRequest) {
  const headers={'Cache-Control':'private, no-store'}
  const browseTiming:BrowseTiming={}
  function responseHeaders() {
    const metrics=[]
    if(browseTiming.sessionCheckMs!==undefined)metrics.push(`vb365_session;dur=${browseTiming.sessionCheckMs}`)
    if(browseTiming.sourceReadMs!==undefined)metrics.push(`vb365_read;dur=${browseTiming.sourceReadMs}`)
    return metrics.length ? {...headers,'Server-Timing':metrics.join(', ')} : headers
  }
  try {
    const write=request.method==='POST'
    if(write) {
      // NextURL normalizes loopback hosts to localhost; the browser retains
      // the requested Host in Origin. Use the same host-aware check as VBR.
      let expectedOrigin:string
      try {expectedOrigin=applicationOrigin(request)}
      catch {throw new RecoveryError('Recovery actions must originate from this application.',403)}
      assertRecoveryOrigin(request.headers.get('origin'),expectedOrigin,request.headers.get('sec-fetch-site'))
    }
    let input:unknown
    if(write) {
      const contentType=request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
      const downloadForm=contentType==='application/x-www-form-urlencoded'
      if(!downloadForm && contentType!=='application/json')throw new RecoveryError('Send recovery options as JSON.',415)
      if(Number(request.headers.get('content-length') || 0)>256*1024)throw new RecoveryError('Recovery options are too large.',413)
      const body=await request.text()
      if(body.length>256*1024)throw new RecoveryError('Recovery options are too large.',413)
      if(downloadForm){
        input=Object.fromEntries(new URLSearchParams(body))
        if(record(input).action!=='downloadOriginal')throw new RecoveryError('Invalid download request.')
      }else try {input=JSON.parse(body)}catch {throw new RecoveryError('Recovery options are invalid JSON.')}
    }else input=Object.fromEntries(request.nextUrl.searchParams)
    const jar=await cookies()
    const sourceId=jar.get('veeam_vb365_source_id')?.value
    const contentRequest=write && ['viewContent','downloadOriginal'].includes(String(record(input).action))
    const legacyToken=contentRequest && !sourceId ? getChunkedCookie(jar,'veeam_vb365_token') : undefined
    if(contentRequest && !sourceId && !legacyToken)throw new RecoveryError('Connect to this Microsoft 365 source to view backup content.',401)
    const resolvedId=sourceId || (!contentRequest ? configStore.getAll().find(source=>source.platform==='vb365')?.id : undefined)
    const source=resolvedId ? configStore.getById(resolvedId):null
    if(sourceId && (!source || source.platform!=='vb365'))throw new RecoveryError('Select a valid Microsoft 365 data source.')
    const baseUrl=source ? `${source.protocol}://${source.host}:${source.port}`:process.env.VBM_API_URL
    if(!baseUrl)throw new RecoveryError('Connect a Microsoft 365 data source first.')
    const fallback=source || legacyToken ? null:await getVB365Config(),destination=new URL(baseUrl)
    if(legacyToken && jar.get('veeam_vb365_token_url')?.value?.replace(/\/$/,'')!==destination.origin)throw new RecoveryError('Reconnect the Microsoft 365 data source.',401)
    const token=legacyToken || (source ? await tokenManager.getToken(source.id):fallback && new URL(fallback.baseUrl).origin===destination.origin ? fallback.token:null)
    if(!token)throw new RecoveryError('Your Microsoft 365 session has expired. Reconnect the data source.',401)
    let activeToken=token
    async function refresh(){
      const fresh=source ? await tokenManager.refreshToken(source.id) : legacyToken ? null : await refreshVB365Token()
      if(fresh)activeToken=fresh
      return fresh
    }
    const execute=recoveryTransport({baseUrl,token,refresh,...(!write||contentRequest ? {signal:request.signal}:{})})
    const context={execute,browseTiming,scope:readCacheScope(destination.href,token,source || undefined),sourceName:source?.host || destination.hostname,sourceOrigin:destination.origin,signal:request.signal}
    if(contentRequest){
      return await viewContent({...context,actor:source?.username},input,async(path,body,signal)=>{
        const send=()=>fetch(new URL(path,destination.origin),{
          method:'POST',headers:{Authorization:`Bearer ${activeToken}`,Accept:'application/octet-stream',...(body?{'Content-Type':'application/json'}:{})},
          body:body?JSON.stringify(body):undefined,signal,cache:'no-store',redirect:'error',
        })
        const res=await send()
        if(res.status!==401 || !await refresh())return res
        await res.body?.cancel()
        return send()
      })
    }
    if(write && record(input).action==='start' && request.headers.get('prefer')?.trim().toLowerCase()==='respond-async') {
      const {requestId,result}=beginBrowseSession(context,input)
      // Keep the upstream request alive while the picker monitors its scoped receipt.
      after(result.then(()=>{},()=>{}))
      return NextResponse.json({requestId,status:'pending'},{status:202,headers:{...headers,'Preference-Applied':'respond-async'}})
    }
    return NextResponse.json(write ? await recoveryPost(context,input):await recoveryGet(context,input as Record<string,unknown>),{headers:responseHeaders()})
  }catch(error) {
    if (isRecoveryError(error)) {
      const code = request.method==='GET' && error.status===404 && error.code===browseCollectionNotFound ? error.code : undefined
      return NextResponse.json({error:error.message,outcomeUnknown:error.outcomeUnknown,code},{status:error.status,headers:responseHeaders()})
    }
    const invalidOptions = error instanceof ZodError
    const message = invalidOptions ? 'Some recovery options are missing or invalid. Review the selected items, destination and authentication.' : 'Microsoft 365 recovery data could not be loaded.'
    // Never echo request bodies or upstream error payloads: they can contain restore credentials.
    return NextResponse.json({error:message,outcomeUnknown:!invalidOptions},{status:invalidOptions ? 400:502,headers:responseHeaders()})
  }
}
