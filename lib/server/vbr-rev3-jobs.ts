// Open Backup UI v1.3.0
import { NextRequest,NextResponse } from 'next/server'
import { z } from 'zod'
import { tokenManager } from './token-manager'
import { selectedVbrWriteSource } from './vbr-write-source'
import { TopologyRequestError } from '../topology/load'
import { normalizedEstimate } from '../job-builder/rev3-validation'

// Callers have checked the selected source's revision, request origin and native payload.
export async function sendRev3Job(request:NextRequest,sourceKey:string,op:'estimate'|'create'|'edit',body:unknown,id?:string){
  const headers={'Cache-Control':'private, no-store'}
  const fail=(error:string,status:number,uncertain=false)=>NextResponse.json({error,uncertain},{status,headers})
  let connection
  try { connection=await selectedVbrWriteSource(request,sourceKey) }
  catch(error) { if(error instanceof TopologyRequestError)return fail(error.message,error.status); throw error }
  const {target,sourceId}=connection
  let token:string|null=connection.token
  if(op==='edit' && !z.string().uuid().safeParse(id).success)return fail('Invalid job ID.',400)
  const path=op==='estimate'?'/api/v1/jobs/sourcesSize/calculate':op==='edit'?'/api/v1/jobs/'+id:'/api/v1/jobs'
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(60_000)])
  const send=()=>fetch(new URL(path,target),{method:op==='edit'?'PUT':'POST',headers:{Authorization:`Bearer ${token}`,Accept:'application/json','Content-Type':'application/json','x-api-version':'1.3-rev3'},
    body:JSON.stringify(body),signal,cache:'no-store',redirect:'error'})
  try{
    let response=await send()
    if(response.status===401&&sourceId){token=await tokenManager.refreshToken(sourceId);if(token)response=await send()}
    if(!response.ok){
      if(response.status>=500)return fail('VBR could not confirm the operation. Check Jobs & Policies before trying again.',502,true)
      return fail(`VBR rejected the request (HTTP ${response.status}). Check the settings and account permissions.`, response.status>=400&&response.status<500?response.status:502)
    }
    const result=await response.json()
    if(op==='estimate')return NextResponse.json(normalizedEstimate(result),{headers})
    const job=z.object({id:z.string().uuid(),name:z.string()}).parse(result)
    if(id&&job.id!==id)throw Error('Unexpected job identity.')
    return NextResponse.json(job,{status:op==='edit'?200:201,headers})
  }catch{return fail('The operation outcome is unconfirmed. Check Jobs & Policies before trying again.',502,true)}
}
