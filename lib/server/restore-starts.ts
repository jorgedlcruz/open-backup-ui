// Open Backup UI v1.2.0
import {createHash,randomUUID} from 'node:crypto'
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {z} from 'zod'
import {restoreOperations,type RestoreResult,type RestoreStartStatus} from '../restore-points/workflow'
import {VbrRecoveryError} from '../recovery/error'
import {withFileLease} from './file-lease'

const hash=z.string().regex(/^[a-f0-9]{64}$/)
const guid=z.string().uuid().transform(value=>value.toLowerCase())
const binding=z.object({sourceKey:hash,cacheKey:hash,requestId:guid})
type Binding=z.infer<typeof binding>
const result=z.object({id:guid,sourceKey:hash,sessionType:z.string().optional(),state:z.string().optional(),
  mountErrors:z.array(z.object({type:z.string(),message:z.string()})).optional()})
const recordSchema=binding.extend({operation:z.enum(restoreOperations),payloadHash:hash,createdAt:z.number(),attempted:z.boolean(),
  phase:z.enum(['starting','accepted','rejected','unknown']),result:result.optional(),message:z.string().max(1000).optional()})
type Record=z.infer<typeof recordSchema>
type Schedule=(callback:()=>Promise<void>)=>void
type Prepare=()=>Promise<()=>Promise<RestoreResult>>
const deadline=30*60_000
const unknown='The result is unknown. Check Sessions before trying again.'
const notStarted='The recovery was not started. Review the selected restore point and try again.'
const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT'
const digest=(payload:unknown)=>createHash('sha256').update(JSON.stringify(payload)).digest('hex')

/** A durable intent, followed by one immutable result. No observer can start or replay work. */
export class RestoreStarts {
  constructor(private readonly directory=path.join(process.cwd(),'data','restore-starts'),private readonly now=Date.now){}
  private file(key:Binding){const checked=binding.parse(key);return path.join(this.directory,checked.sourceKey,checked.cacheKey,checked.requestId+'.json')}
  private async read(key:Binding):Promise<Record|undefined>{
    const file=this.file(key)
    let row:Record
    try{row=recordSchema.parse(JSON.parse(await fs.readFile(file,'utf8')))}catch(error){if(missing(error))return;throw error}
    if(row.sourceKey!==key.sourceKey||row.cacheKey!==key.cacheKey||row.requestId!==key.requestId)
      throw new VbrRecoveryError('This recovery request belongs to another session or source.',409)
    try{
      const attempt=recordSchema.parse(JSON.parse(await fs.readFile(file+'.attempt','utf8')))
      if(attempt.sourceKey!==row.sourceKey||attempt.cacheKey!==row.cacheKey||attempt.requestId!==row.requestId||attempt.operation!==row.operation||
        attempt.payloadHash!==row.payloadHash||attempt.createdAt!==row.createdAt||!attempt.attempted||attempt.phase!=='starting'||attempt.result)
        throw new VbrRecoveryError('The recovery request could not be verified.',409)
      row=attempt
    }catch(error){if(!missing(error))throw error}
    try{
      const final=recordSchema.parse(JSON.parse(await fs.readFile(file+'.result','utf8')))
      if(final.sourceKey!==row.sourceKey||final.cacheKey!==row.cacheKey||final.requestId!==row.requestId||final.operation!==row.operation||
        final.payloadHash!==row.payloadHash||final.createdAt!==row.createdAt||final.attempted!==row.attempted||final.phase==='starting'||
        (final.phase==='accepted'&&(!final.result||final.result.sourceKey!==key.sourceKey||!row.attempted)))
        throw new VbrRecoveryError('The recovery result could not be verified.',409)
      row=final
    }catch(error){if(!missing(error))throw error}
    return row
  }
  private async publish(file:string,row:Record){
    const temp=file+'.'+randomUUID()+'.tmp'
    // Publish complete JSON exclusively. A stale lease cannot replace an intent,
    // claim a second native attempt, or expose a partially-written receipt.
    try{
      await fs.writeFile(temp,JSON.stringify(recordSchema.parse(row)),{flag:'wx',mode:0o600})
      try{await fs.link(temp,file);return true}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')return false;throw error}
    }
    finally{await fs.unlink(temp).catch(()=>{})}
  }
  private async locked<T>(key:Binding,work:()=>Promise<T>):Promise<T>{
    for(let i=0;i<100;i++){
      const box=await withFileLease(this.file(key)+'.lock',30_000,async()=>({value:await work()}))
      if(box)return box.value
      await new Promise(resolve=>setTimeout(resolve,35))
    }
    throw new VbrRecoveryError('The recovery request could not be reserved. Check Sessions before trying again.',503)
  }
  private summary(row:Record):RestoreStartStatus{
    const expired=row.phase==='starting'&&this.now()-row.createdAt>=deadline
    return {sourceKey:row.sourceKey,requestId:row.requestId,operation:row.operation,
      phase:expired?(row.attempted?'unknown':'rejected'):row.phase,
      ...(row.result?{sessionId:row.result.id,mountErrors:row.result.mountErrors}:{}),
      ...(expired?{message:row.attempted?unknown:notStarted}:row.message?{message:row.message}:{})}
  }
  async observe(key:Binding){const row=await this.read(key);if(!row)throw new VbrRecoveryError('Recovery request not found.',404);return this.summary(row)}
  private async finish(key:Binding,row:Record){
    if(!await this.publish(this.file(key)+'.result',row))await this.read(key)
  }
  async submit(key:Binding,operation:Record['operation'],payload:unknown,schedule:Schedule,prepare:Prepare):Promise<RestoreStartStatus>{
    binding.parse(key)
    const payloadHash=digest(payload)
    const existing=(previous:Record)=>{
      if(previous.payloadHash!==payloadHash||previous.operation!==operation)throw new VbrRecoveryError('This recovery request ID was already used for different settings.',409)
      return {row:previous,owns:false}
    }
    const reservation=await this.locked(key,async()=>{
      const previous=await this.read(key)
      if(previous)return existing(previous)
      const row:Record={...key,operation,payloadHash,createdAt:this.now(),attempted:false,phase:'starting'}
      if(!await this.publish(this.file(key),row))return existing((await this.read(key))!)
      return {row,owns:true}
    })
    if(!reservation.owns)return this.summary(reservation.row)
    const complete=async()=>{
      let submit:Awaited<ReturnType<Prepare>>
      try{submit=await prepare()}
      catch(error){
        await this.locked(key,async()=>{
          const row=await this.read(key)
          if(row?.phase==='starting'&&!row.attempted)await this.finish(key,{...row,phase:'rejected',
            message:error instanceof VbrRecoveryError?error.message.slice(0,1000):notStarted})
        })
        return
      }
      // Persist exclusive ownership before calling VBR. A restart never reclaims it.
      const intent=await this.locked(key,async()=>{
        const row=await this.read(key)
        if(!row||row.phase!=='starting'||row.attempted||this.now()-row.createdAt>=deadline)return
        existing(row)
        const attempted={...row,attempted:true}
        // Exclusive immutable fence, independent of the reusable advisory lease.
        // A crash after this claim is unknown; no process reclaims or replays it.
        if(await this.publish(this.file(key)+'.attempt',attempted))return attempted
      })
      if(!intent)return
      let final:Record
      try{
        const accepted=result.parse(await submit())
        if(accepted.sourceKey!==key.sourceKey)throw new VbrRecoveryError(unknown,502,true)
        final={...intent,phase:'accepted',result:accepted}
      }catch(error){
        const rejected=error instanceof VbrRecoveryError&&!error.uncertain&&error.status>=400&&error.status<500&&error.status!==408
        final={...intent,phase:rejected?'rejected':'unknown',message:rejected?error.message.slice(0,1000):unknown}
      }
      await this.finish(key,final)
    }
    try{schedule(complete)}
    catch{await this.finish(key,{...reservation.row,phase:'rejected',message:notStarted})}
    return this.observe(key)
  }
}
export const restoreStarts=new RestoreStarts()
