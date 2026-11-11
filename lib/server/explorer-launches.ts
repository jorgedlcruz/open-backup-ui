// Open Backup UI v1.2.0
import { createHmac,randomUUID,timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {z} from 'zod'
import {validId} from '../investigation/model'
import {VbrRecoveryError} from '../recovery/error'
import {withFileLease} from './file-lease'
import {replaceFile} from './atomic-file'
import {rememberExplorerSession,type ExplorerKind} from './explorer-session-records'
import type {RecoverySend} from './vbr-recovery'

const guid=z.string().refine(validId).transform(value=>value.toLowerCase())
const hash=z.string().regex(/^[a-f0-9]{64}$/)
const scope=z.object({sourceKey:hash,principalKey:hash,kind:z.enum(['sql','activeDirectory'])})
type Scope=z.infer<typeof scope>
const point=z.object({backupId:guid,objectId:guid,restorePointId:guid,reviewedMalwareStatus:z.string().max(64).nullish()})
type Point=z.infer<typeof point>
const status=z.enum(['starting','pending','ready','failed','unknown'])
const record=scope.merge(point).extend({requestId:guid,status,createdAt:z.number(),attempted:z.boolean(),taskId:guid.optional(),sessionId:guid.optional(),error:z.string().max(1100).optional()})
type Record=z.infer<typeof record>
export type ExplorerRequestSummary={
  requestId:string;kind:ExplorerKind;restorePointId:string;backupId:string;backupObjectId:string;createdAt:string
  requestStatus:Record['status'];sessionId?:string;error?:string
}
const uncertain='VBR could not confirm the operation. Check Sessions before trying again.'
const unavailable='VBR could not verify this recovery request.'
const notStarted='Explorer was not started. Open Backup UI could not finish preparing this request. Review the selected restore point and try again.'
const localNotStarted='Explorer was not started because Open Backup UI could not save the recovery request. Check that its data folder is writable, then review the selected restore point and try again.'
const localUnknown='Open Backup UI could not save the VBR response. Check the recovery status before submitting another request.'
class ExplorerReceiptError extends Error {}
const equal=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
const nativeTask=z.object({id:guid,type:z.literal('Common'),state:z.string(),result:z.string().nullish(),additionalInfo:z.object({message:z.string().nullish()}).nullish()})
const nativeId=z.object({id:guid})
const noFile=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT'
const nativeBase=(kind:ExplorerKind)=>'/private-api/v1/backupBrowser/applicationItems/'+(kind==='sql'?'vesql':'vead')

export class ExplorerLaunches {
  constructor(private readonly base=path.join(process.cwd(),'data','explorer-launches'),private readonly now=Date.now,
    private readonly remember:typeof rememberExplorerSession=rememberExplorerSession){}
  async list(key:Pick<Scope,'sourceKey'|'principalKey'>):Promise<ExplorerRequestSummary[]> {
    const directory=path.join(this.base,hash.parse(key.sourceKey),hash.parse(key.principalKey))
    let names:string[]
    try{names=await fs.readdir(directory)}catch(error){if(noFile(error))return [];throw error}
    const rows:ExplorerRequestSummary[]=[]
    for(const name of names){
      if(!name.endsWith('.json')||!validId(name.slice(0,-5)))continue
      let row=record.parse(JSON.parse(await fs.readFile(path.join(directory,name),'utf8')))
      if(row.requestId+'.json'!==name||row.principalKey!==key.principalKey||row.sourceKey!==key.sourceKey)
        throw new VbrRecoveryError('This Explorer request belongs to another session or source.',409)
      row=await this.failure(row)
      const expired=row.status==='starting'&&this.now()-row.createdAt>5*60_000
      const requestStatus=expired?(row.attempted?'unknown':'failed'):row.status
      rows.push({requestId:row.requestId,kind:row.kind,restorePointId:row.restorePointId,backupId:row.backupId,backupObjectId:row.objectId,
        createdAt:new Date(row.createdAt).toISOString(),requestStatus,...(row.sessionId?{sessionId:row.sessionId}:{}),
        ...(row.error||expired?{error:row.error||(row.attempted?uncertain:notStarted)}:{})})
    }
    return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
  }
  private file(key:Scope,id:string) {
    scope.parse(key)
    return path.join(this.base,key.sourceKey,key.principalKey,guid.parse(id)+'.json')
  }
  private async failure(row:Record):Promise<Record> {
    if(row.status!=='starting')return row
    try {
      const failed=record.parse(JSON.parse(await fs.readFile(this.file(row,row.requestId)+'.failure','utf8')))
      if(failed.sourceKey!==row.sourceKey||failed.principalKey!==row.principalKey||failed.requestId!==row.requestId||
        failed.kind!==row.kind||failed.restorePointId!==row.restorePointId||failed.backupId!==row.backupId||failed.objectId!==row.objectId||
        failed.createdAt!==row.createdAt||failed.attempted!==row.attempted||failed.status!==(row.attempted?'unknown':'failed'))
        throw new VbrRecoveryError('Invalid Explorer request.',409)
      return failed
    }catch(error){if(!noFile(error))throw error}
    return row
  }
  private async read(key:Scope,id:string) {
    try{
      const row=record.parse(JSON.parse(await fs.readFile(this.file(key,id),'utf8')))
      if(row.requestId!==id||row.sourceKey!==key.sourceKey||row.principalKey!==key.principalKey||row.kind!==key.kind)
        throw new VbrRecoveryError('This Explorer request belongs to another session or source.',409)
      return await this.failure(row)
    }catch(error){if(!noFile(error))throw error}
  }
  private async locked<T>(key:Scope,id:string,work:(previous:Record|undefined)=>{row:Record;value:T}|Promise<{row:Record;value:T}>) {
    const file=this.file(key,id)
    for(let i=0;i<100;i++){
      const box=await withFileLease(file+'.lock',30_000,async()=>{
        const previous=await this.read(key,id), {row,value}=await work(previous)
        if(row!==previous){
          const tmp=file+'.'+randomUUID()
          try{await fs.writeFile(tmp,JSON.stringify(record.parse(row)),{flag:'wx',mode:0o600});await replaceFile(tmp,file)}
          catch(error){
            // A newly-created sidecar can still be persisted when Windows keeps
            // the existing receipt open. Record a terminal, scoped result while
            // holding the lease, so another worker cannot claim a failed intent.
            // After a POST, preserve its exact acknowledgement and uncertainty.
            if(previous?.status==='starting'){
              const failed:Record={...previous,status:previous.attempted?'unknown':'failed',
                error:previous.attempted?localUnknown:localNotStarted,...(row.taskId?{taskId:row.taskId}:{})}
              try { await fs.writeFile(file+'.failure',JSON.stringify(record.parse(failed)),{flag:'wx',mode:0o600}) }
              catch(writeError){if((writeError as NodeJS.ErrnoException).code!=='EEXIST')throw error}
              throw new ExplorerReceiptError(failed.error)
            }
            throw error
          }
          finally{await fs.unlink(tmp).catch(()=>{})}
        }
        return {value}
      })
      if(box)return box.value
      await new Promise(resolve=>setTimeout(resolve,35))
    }
    throw new VbrRecoveryError('Request failed.',503)
  }
  reserve(key:Scope,id:string,data:Point) {
    const target=point.parse(data)
    return this.locked(key,id,previous=>{
      if(previous){
        if(previous.restorePointId!==target.restorePointId||previous.backupId!==target.backupId||previous.objectId!==target.objectId||
          (previous.reviewedMalwareStatus??null)!==(target.reviewedMalwareStatus??null))throw new VbrRecoveryError('This Explorer request belongs to another session or source.',409)
        return {row:previous,value:false}
      }
      return {row:{...key,...target,requestId:id,status:'starting',attempted:false,createdAt:this.now()},value:true}
    })
  }
  private update(key:Scope,id:string,expected:Record['status'],changes:Partial<Record>) {
    return this.locked(key,id,previous=>{
      if(!previous)throw new VbrRecoveryError('Invalid Explorer request.',404)
      const row=previous.status===expected?{...previous,...changes}:previous
      return {row,value:row}
    })
  }
  async submit(key:Scope,id:string,data:Point,verify:()=>Promise<unknown>,send:RecoverySend){
    try { await this.submitOnce(key,id,data,verify,send) }
    catch(error){if(!(error instanceof ExplorerReceiptError))throw error}
  }
  private async submitOnce(key:Scope,id:string,data:Point,verify:()=>Promise<unknown>,send:RecoverySend){
    try{await verify()}
    catch(error){
      await this.update(key,id,'starting',{status:'failed',error:error instanceof VbrRecoveryError?error.message.slice(0,1000):unavailable})
      return
    }
    // Persist intent before the irreversible POST. No restart path resends this request.
    const owns=await this.locked(key,id,previous=>{
      if(!previous)throw new VbrRecoveryError('Invalid Explorer request.',404)
      if(previous.status!=='starting'||previous.attempted||this.now()-previous.createdAt>5*60_000)return {row:previous,value:false}
      return {row:{...previous,attempted:true},value:true}
    })
    if(!owns)return
    let taskId:string
    try{
      const result=nativeId.safeParse(await send(nativeBase(key.kind),{method:'POST',mutation:true,body:{restorePointId:data.restorePointId}}))
      if(!result.success)throw new VbrRecoveryError(uncertain,502,true)
      taskId=result.data.id
    }catch(error){
      const rejected=error instanceof VbrRecoveryError&&!error.uncertain&&error.status>=400&&error.status<500&&error.status!==408
      await this.update(key,id,'starting',{status:rejected?'failed':'unknown',error:rejected?error.message.slice(0,1000):uncertain})
      return
    }
    await this.update(key,id,'starting',{status:'pending',taskId})
  }
  private async reconcile(key:Scope,row:Record,send:RecoverySend){
    if(!['pending','unknown'].includes(row.status)||!row.taskId)return row
    const task=nativeTask.safeParse(await send('/private-api/v1/tasks/'+row.taskId))
    if(!task.success||task.data.id!==row.taskId)throw new VbrRecoveryError('VBR returned a different Explorer task.',502)
    // The acknowledgement survived in the sidecar. A successful read of that
    // exact live task is enough to keep the client polling, even if replacement
    // of the main receipt is still locked.
    if(task.data.state!=='Stopped')return {...row,status:'pending' as const}
    if(!['Success','Warning'].includes(task.data.result||'')) {
      if(!task.data.result||task.data.result==='None')return {...row,status:'pending' as const}
      return this.update(key,row.requestId,row.status,{status:'failed',error:task.data.additionalInfo?.message?.slice(0,1000)||'The VBR Explorer task did not complete successfully.'})
    }
    const session=nativeId.safeParse(await send(nativeBase(key.kind)+'/'+row.taskId+'/result'))
    if(!session.success)throw new VbrRecoveryError('VBR did not return the Explorer task or session ID. Check Sessions before trying again.',502)
    return this.locked(key,row.requestId,async current=>{
      if(!current)throw new VbrRecoveryError('Invalid Explorer request.',404)
      if(!['pending','unknown'].includes(current.status)||!current.taskId)return {row:current,value:current}
      await this.remember({...key,sessionId:session.data.id},key.kind,false,row.restorePointId)
      const next:Record={...current,status:'ready',sessionId:session.data.id}
      return {row:next,value:next}
    })
  }
  private handle(key:Scope,id:string,secret:string){
    const mac=createHmac('sha256',secret).update(JSON.stringify(['explorer-launch-v1',key.sourceKey,key.principalKey,key.kind,id])).digest('base64url')
    return 'launch1.'+id+'.'+mac
  }
  async response(key:Scope,id:string,secret:string,send?:RecoverySend,token?:string){
    const pending=this.handle(key,id,secret)
    if(token&&!equal(token,pending))throw new VbrRecoveryError('This Explorer request belongs to another session or source.',409)
    const saved=await this.read(key,id),base={sourceKey:key.sourceKey,requestId:id}
    if(!saved)return {...base,requestStatus:'missing' as const}
    let row=saved
    if(send){
      try{row=await this.reconcile(key,saved,send)}
      catch(error){
        if(error instanceof VbrRecoveryError && (error.status===401||error.status===403))throw error
        if(!['pending','unknown'].includes(saved.status)||!saved.taskId)throw error
        // Keep the native task reference even when VBR expires task history, or
        // temporarily loses its gateway. A later status read may still resolve it.
        if(this.now()-saved.createdAt>10*60_000)return {...base,requestStatus:'unknown' as const,error:uncertain}
        return {...base,requestStatus:'pending' as const,pending}
      }
    }
    // If the worker died before a task acknowledgement, report uncertainty without
    // reclaiming its right to issue a second native start. Late acknowledgements win.
    const stale=row.status==='starting' && this.now()-row.createdAt>5*60_000
    if(stale)return {...base,requestStatus:row.attempted?'unknown' as const:'failed' as const,error:row.attempted?uncertain:notStarted}
    if(row.status==='ready')return {...base,requestStatus:row.status,sessionId:row.sessionId,restorePointId:row.restorePointId,
      backupId:row.backupId,backupObjectId:row.objectId,application:key.kind==='sql'?'SQL':'ActiveDirectory'}
    if(row.status==='failed'||row.status==='unknown')return {...base,requestStatus:row.status,error:row.error}
    return {...base,requestStatus:row.status,pending}
  }
}
export const explorerLaunches=new ExplorerLaunches()
