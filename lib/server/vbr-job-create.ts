import { cookies } from 'next/headers'
import { NextRequest,NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { configStore } from './config-store'
import { tokenManager } from './token-manager'
import { getChunkedCookie } from '../utils/cookie-manager'
import { compileJob,type Draft } from '../job-builder/model'
import type { VbrRevision } from './vbr-read'

// One narrow mutation: create a validated backup job. Never follow redirects,
// auto-start a session, or retry an ambiguous network/server response.
export async function createVbrJob(request:NextRequest,draft:Draft,revision:VbrRevision) {
  const headers={'Cache-Control':'private, no-store'}
  const fail=(error:string,status:number,uncertain=false)=>NextResponse.json({error,uncertain},{status,headers})
  const jar=await cookies(),sourceId=jar.get('veeam_source_id')?.value,source=sourceId?configStore.getById(sourceId):undefined
  if(sourceId&&(!source||source.platform!=='vbr'))return fail('Select a valid VBR source.',400)
  const base=source?`${source.protocol}://${source.host}:${source.port}`:process.env.VEEAM_API_URL
  if(!base)return fail('Connect a VBR source.',400)
  const destination=new URL(base)
  if(!['http:','https:'].includes(destination.protocol))return fail('Invalid VBR source protocol.',400)
  const sourceKey=createHash('sha256').update(JSON.stringify([destination.href,source?.id||'environment'])).digest('hex')
  if(draft.sourceKey!==sourceKey)return fail('The VBR source changed. Reload and validate again.',409)
  let token=sourceId?await tokenManager.getToken(sourceId):null
  token ||= getChunkedCookie(jar,'veeam_vbr_token')||null
  if(!token)return fail('Reconnect the VBR data source.',401)
  const payload=JSON.stringify(compileJob(draft)),signal=AbortSignal.any([request.signal,AbortSignal.timeout(60000)])
  try {
    const send=()=>fetch(new URL('/api/v1/jobs',destination),{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json','x-api-version':revision},body:payload,redirect:'error',cache:'no-store',signal})
    let response=await send()
    if(response.status===401&&sourceId){token=await tokenManager.refreshToken(sourceId);if(token)response=await send()}
    if(!response.ok) {
      if(response.status>=500)return fail('VBR could not confirm creation. Check Jobs & Policies before trying again.',502,true)
      const data=await response.json().catch(()=>null)
      const reason=typeof data?.message==='string'?data.message.slice(0,1500):`VBR rejected the job (HTTP ${response.status}). Review the settings and permissions.`
      return fail(reason,response.status>=400&&response.status<500?response.status:502)
    }
    const result=z.object({id:z.string().uuid(),name:z.string()}).safeParse(await response.json().catch(()=>null))
    if(!result.success)return fail('VBR accepted the request but returned no confirmed job identity. Check Jobs & Policies.',502,true)
    return NextResponse.json({id:result.data.id,name:result.data.name},{status:201,headers})
  } catch {return fail('The connection ended before creation could be confirmed. Check Jobs & Policies before creating another job.',502,true)}
}
