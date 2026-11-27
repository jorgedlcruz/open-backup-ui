// Open Backup UI v1.3.0
import { z } from 'zod'
import { opaqueId } from '../vbm-protected/model'
import { assertWorkload, record, RecoveryError, sessionIdSchema, workloadSchema } from './model'
import { entityPath } from './paths'
import { getSession } from './load'
import type { Execute } from './transport'
import { recordContentAccess } from './browse-activity'
import { matchesPreviewMedia, previewLimit, previewMedia } from './content-types'
import { readMessageBody } from './message-reader'

const inputSchema=z.object({
  action:z.enum(['viewContent','downloadOriginal']),sessionId:sessionIdSchema,workload:workloadSchema,
  id:opaqueId,ownerId:opaqueId,kind:z.enum(['item','file','document']),channelId:opaqueId.optional(),
}).strict()
type ContentContext={execute:Execute;scope:string;sourceName:string;sourceOrigin:string;signal:AbortSignal;actor?:string}
type Save=(path:string,body:{asZip:false}|undefined,signal:AbortSignal)=>Promise<Response>
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer'}

async function boundedBytes(response:Response) {
  if(Number(response.headers.get('content-length'))>previewLimit){
    await response.body?.cancel()
    throw new RecoveryError('This item is too large for inline viewing. Download the original to open it.',413)
  }
  const chunks:Uint8Array[]=[]
  let size=0
  const reader=response.body?.getReader()
  if(!reader) throw new RecoveryError('The backup source returned no file.',502)
  try {
    while(true){
      const part=await reader.read()
      if(part.done)break
      size+=part.value.byteLength
      if(size>previewLimit){await reader.cancel();throw new RecoveryError('This item is too large for inline viewing. Download the original to open it.',413)}
      chunks.push(part.value)
    }
  }finally{reader.releaseLock()}
  const bytes=new Uint8Array(size)
  let offset=0
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  return bytes
}

export async function viewContent(context:ContentContext,input:unknown,save:Save,audit=recordContentAccess) {
  const data=inputSchema.parse(input),{workload,sessionId}=data
  const exchange=workload==='Exchange',teams=workload==='Teams'
  if(data.kind!==(exchange?'item':teams?'file':'document') || teams!==!!data.channelId)throw new RecoveryError('Unsupported backup item.')
  const session=await getSession(context,sessionId)
  assertWorkload(session,workload)
  if(session.state!=='Working')throw new RecoveryError('This recovery session is not open for browsing.',409)
  const path=entityPath(sessionId,workload,data)
  const item=record(await context.execute(path))
  const owner=item[exchange?'mailboxId':teams?'teamId':workload==='OneDrive'?'oneDriveId':'siteId']
  if(item.id!==data.id || owner!==undefined && owner!==data.ownerId || item.channelId!==undefined && item.channelId!==data.channelId ||
      item.isFolder===true || item.fileType==='Folder' || (exchange && !/^(?:report\.)?ipm\.note(?:\.|$)/i.test(String(item.itemClass))))
    throw new RecoveryError('The selected backup item could not be verified.',409)
  const name=String(exchange?(item.subject||'Message')+'.msg':item.name||'download').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g,'_').slice(0,200)
  const media=previewMedia(name)
  const download=data.action==='downloadOriginal'
  if(!download && !exchange && !media)throw new RecoveryError('Download the original to open this file type.',415)
  if(!download && Number(item.sizeBytes)>previewLimit)throw new RecoveryError('This item is too large for inline viewing. Download the original to open it.',413)
  const signal=AbortSignal.any([context.signal,AbortSignal.timeout(5*60_000)])
  const started=Date.now()
  const upstream=await save(path+'/save',exchange?undefined:{asZip:false},signal)
  if(!upstream.ok || !upstream.body){
    await upstream.body?.cancel()
    if(upstream.status===401 || upstream.status===403)throw new RecoveryError('The backup source denied access to export this item.',upstream.status)
    throw new RecoveryError('The backup source could not export this item.',502)
  }
  const event={action:download?'Original download opened' as const:'Item preview opened' as const,workload,source:context.sourceName,ownerId:data.ownerId,channelId:data.channelId,itemId:data.id,actor:context.actor}
  const log=async()=>{if(await audit(context.scope,sessionId,{...event,durationMs:Date.now()-started})!=='available')throw new RecoveryError('The application could not record access to the backup item.',503)}
  if(download){
    try {await log()}catch(error){await upstream.body.cancel();throw error}
    const fallback=name.replace(/[^\x20-\x7e]/g,'_')
    const encoded=encodeURIComponent(name.toWellFormed()).replace(/['()*]/g,char=>'%'+char.charCodeAt(0).toString(16))
    return new Response(upstream.body,{headers:{...headers,'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`}})
  }
  const bytes=await boundedBytes(upstream)
  if(exchange){
    const body=await readMessageBody(bytes,signal)
    await log()
    return Response.json(body,{headers})
  }
  if(!media || !matchesPreviewMedia(bytes,media))throw new RecoveryError('This file cannot be displayed inline. Download the original to open it.',415)
  await log()
  return new Response(bytes,{headers:{...headers,'Content-Type':media,'Content-Disposition':'attachment'}})
}
