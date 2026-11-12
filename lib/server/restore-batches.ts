// Open Backup UI v1.2.0
import {createHash,randomUUID} from 'node:crypto'
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {z} from 'zod'
import {withFileLease} from './file-lease'
import {vmBatchKind,type BatchReceipt,type BatchItem} from '../restore-points/batch'
import type {VmBatch,BatchIdentity} from '../recovery/vm-batch'
import {VbrRecoveryError} from '../recovery/error'

export type BatchScope={sourceKey:string;cacheKey:string}
type RecordRow={draft:VmBatch['items'][number]['draft'];item:BatchItem;identity?:BatchIdentity}
type Record={id:string;sourceKey:string;digest:string;createdAt:string;updatedAt:string;kind:BatchReceipt['kind'];rows:RecordRow[];
  runner?:{id:string;until:number}}
const hash=z.string().regex(/^[a-f0-9]{64}$/),guid=z.string().uuid()
const leaseMs=4*60_000
const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT'
const iso=(ms:number)=>new Date(ms).toISOString()
const checkSessions='VBR submission could not be confirmed. Check Sessions before starting another recovery.'
const draftDigest=(row:{objectId:string;draft:VmBatch['items'][number]['draft']})=>createHash('sha256').update(JSON.stringify(row)).digest('hex')
const batchDigest=(items:{objectId:string;draft:VmBatch['items'][number]['draft']}[])=>createHash('sha256').update(JSON.stringify(items.map(({objectId,draft})=>({objectId,draft})))).digest('hex')
function reclaim(record:Record,now:number) {
  if(!record.runner||record.runner.until>now)return
  for(const {item} of record.rows){
    if(item.status==='submitting'){item.status='unknown';item.message=checkSessions}
    if(item.status==='queued'){item.status='notStarted';item.message='The server stopped before this VM was submitted.'}
  }
  delete record.runner;record.updatedAt=iso(now)
}
function receipt(r:Record):BatchReceipt{return {id:r.id,sourceKey:r.sourceKey,createdAt:r.createdAt,updatedAt:r.updatedAt,kind:r.kind,items:r.rows.map(row=>({...row.item}))}}
export class RestoreBatches {
  constructor(private base=path.join(process.cwd(),'data','restore-batches'),private now=Date.now){}
  private dir(scope:BatchScope){return path.join(this.base,hash.parse(scope.sourceKey),hash.parse(scope.cacheKey))}
  private file(scope:BatchScope,id:string){return path.join(this.dir(scope),guid.parse(id).toLowerCase()+'.json')}
  private attemptFile(scope:BatchScope,id:string,index:number){
    return path.join(this.dir(scope),guid.parse(id).toLowerCase()+'.attempts',z.number().int().min(0).max(31).parse(index)+'.json')
  }
  private async writeOnce(file:string,value:unknown){
    await fs.mkdir(path.dirname(file),{recursive:true})
    const tmp=file+'.'+randomUUID()+'.tmp'
    try{
      const handle=await fs.open(tmp,'wx',0o600)
      try{await handle.writeFile(JSON.stringify(value));await handle.sync()}finally{await handle.close()}
      // Publish complete contents atomically without replacing an existing fence.
      try{await fs.link(tmp,file);return true}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')return false;throw error}
    }finally{await fs.unlink(tmp).catch(()=>{})}
  }
  private async reserveIdentity(scope:BatchScope,id:string,digest:string){
    const file=this.file(scope,id)+'.identity',identity={id:guid.parse(id).toLowerCase(),sourceKey:scope.sourceKey,cacheKey:scope.cacheKey,digest}
    if(await this.writeOnce(file,identity))return
    const saved=JSON.parse(await fs.readFile(file,'utf8'))
    if(saved.id!==identity.id||saved.sourceKey!==identity.sourceKey||saved.cacheKey!==identity.cacheKey||saved.digest!==digest){
      throw new VbrRecoveryError('This batch ID already belongs to a different recovery request.',409)
    }
  }
  private async verifyIdentity(scope:BatchScope,id:string,record:Record){
    if(record.id.toLowerCase()!==guid.parse(id).toLowerCase()||record.sourceKey!==scope.sourceKey
      ||record.rows.length<1||record.rows.length>32||record.digest!==batchDigest(record.rows.map(row=>({objectId:row.item.objectId,draft:row.draft})))){
      throw new VbrRecoveryError('This recovery batch identity could not be verified.',409)
    }
    await this.reserveIdentity(scope,id,record.digest)
    // Upgrade older receipts without making their known submissions replayable.
    for(const [index,row] of record.rows.entries()){
      if(!row.item.sessionId&&!['accepted','submitting','unknown'].includes(row.item.status))continue
      const file=this.attemptFile(scope,id,index)
      try{await fs.stat(file);continue}catch(error){if(!missing(error))throw error}
      await this.writeOnce(file,{legacy:true,createdAt:record.updatedAt,objectId:row.item.objectId,restorePointId:row.item.restorePointId,
        backupId:row.item.backupId,operation:row.item.operation,digest:draftDigest({objectId:row.item.objectId,draft:row.draft})})
    }
  }
  private async reconcileAttempts(scope:BatchScope,id:string,record:Record){
    for(const [index,{item}] of record.rows.entries()){
      if(item.status!=='queued'&&item.status!=='notStarted')continue
      try{await fs.stat(this.attemptFile(scope,id,index))}catch(error){if(missing(error))continue;throw error}
      // The mutable receipt can be stale after overlapping/reclaimed file leases.
      // An immutable attempt is never made safe to replay by that stale receipt.
      item.status=item.sessionId?'accepted':'unknown'
      if(item.sessionId)delete item.message;else item.message=checkSessions
    }
  }
  private async load(file:string):Promise<Record|undefined>{
    try{return JSON.parse(await fs.readFile(file,'utf8')) as Record}catch(error){if(!missing(error))throw error}
  }
  private async write(file:string,record:Record){
    const tmp=file+'.'+randomUUID()
    try{await fs.writeFile(tmp,JSON.stringify(record),{flag:'wx',mode:0o600});await fs.rename(tmp,file)}
    finally{await fs.unlink(tmp).catch(()=>{})}
  }
  private async locked<T>(file:string,work:()=>Promise<T>){
    for(let n=0;n<30;n++){
      const box=await withFileLease(file+'.lock',30_000,async()=>({value:await work()}))
      if(box)return box.value
      await new Promise(r=>setTimeout(r,40))
    }
    throw new VbrRecoveryError('This batch is being updated. Refresh its status.',409)
  }
  async get(scope:BatchScope,id:string){
    const r=await this.load(this.file(scope,id));if(!r)throw new VbrRecoveryError('Recovery batch not found.',404)
    await this.verifyIdentity(scope,id,r)
    reclaim(r,this.now());await this.reconcileAttempts(scope,id,r);return receipt(r)
  }
  async list(scope:BatchScope){
    let names:string[]
    try{names=await fs.readdir(this.dir(scope))}catch(error){if(missing(error))return [];throw error}
    const rows:BatchReceipt[]=[]
    for(const name of names){
      if(!name.endsWith('.json')||!guid.safeParse(name.slice(0,-5)).success)continue
      rows.push(await this.get(scope,name.slice(0,-5)))
    }
    return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
  }
  async create(scope:BatchScope,input:VmBatch){
    const file=this.file(scope,input.batchId),now=this.now()
    // UI labels can change between views; native request identity is the reviewed draft and object.
    const digest=batchDigest(input.items)
    return this.locked(file,async()=>{
      const existing=await this.load(file)
      if(existing){if(existing.digest!==digest)throw new VbrRecoveryError('This batch ID already belongs to a different recovery request.',409)
        await this.verifyIdentity(scope,input.batchId,existing)
        reclaim(existing,this.now());await this.reconcileAttempts(scope,input.batchId,existing);return {receipt:receipt(existing),runner:undefined}}
      await this.reserveIdentity(scope,input.batchId,digest)
      const runner=randomUUID()
      const r:Record={id:input.batchId,sourceKey:scope.sourceKey,createdAt:iso(now),updatedAt:iso(now),kind:vmBatchKind(input.items[0].draft.operation),
        digest,runner:{id:runner,until:now+leaseMs},rows:input.items.map(({objectId,draft,name})=>({draft,item:{objectId,restorePointId:draft.restorePointId,
          backupId:draft.backupId,operation:draft.operation,name:name||draft.restorePointId,targetName:draft.target.vmName||name||draft.restorePointId,
          mode:draft.mode,status:'queued'}}))}
      await this.write(file,r);return {receipt:receipt(r),runner}
    })
  }
  async resume(scope:BatchScope,id:string){
    const file=this.file(scope,id)
    return this.locked(file,async()=>{
      const record=await this.load(file)
      if(!record)throw new VbrRecoveryError('Recovery batch not found.',404)
      await this.verifyIdentity(scope,id,record)
      const now=this.now();reclaim(record,now);await this.reconcileAttempts(scope,id,record)
      if(record.runner||!record.rows.some(r=>r.item.status==='notStarted'))return {receipt:receipt(record),runner:undefined}
      const runner=randomUUID();record.runner={id:runner,until:now+leaseMs};record.updatedAt=iso(now)
      for(const {item} of record.rows)if(item.status==='notStarted'){item.status='queued';delete item.message}
      await this.write(file,record);return {receipt:receipt(record),runner}
    })
  }
  async beginAttempt(scope:BatchScope,id:string,runner:string,index:number,expected:{objectId:string;draft:VmBatch['items'][number]['draft']}){
    const file=this.file(scope,id),attempt=this.attemptFile(scope,id,index)
    return this.locked(file,async()=>{
      const r=await this.load(file),now=this.now()
      if(!r||r.runner?.id!==runner||r.runner.until<=now)throw new VbrRecoveryError('This recovery worker is no longer active.',409)
      await this.verifyIdentity(scope,id,r)
      const row=r.rows[index]
      if(!row||draftDigest({objectId:row.item.objectId,draft:row.draft})!==draftDigest(expected)){
        throw new VbrRecoveryError('This VM recovery request changed before submission.',409)
      }
      if(row.item.status!=='queued')return false
      // One permanent marker per row, separate from the renewable receipt lease.
      // Never delete/reclaim it: even a crash before the POST has an unknown outcome.
      const owned=await this.writeOnce(attempt,{runner,createdAt:iso(now),objectId:expected.objectId,
        restorePointId:expected.draft.restorePointId,backupId:expected.draft.backupId,operation:expected.draft.operation,digest:draftDigest(expected)})
      if(!owned){await this.reconcileAttempts(scope,id,r);await this.write(file,r);return false}
      row.item.status='submitting';delete row.item.message
      r.runner.until=now+leaseMs;r.updatedAt=iso(now)
      await this.write(file,r)
      return true
    })
  }
  async update<T>(scope:BatchScope,id:string,runner:string,work:(record:Record)=>T){
    const file=this.file(scope,id)
    return this.locked(file,async()=>{
      const r=await this.load(file),now=this.now()
      if(!r||r.runner?.id!==runner||r.runner.until<=now)throw new VbrRecoveryError('This recovery worker is no longer active.',409)
      await this.verifyIdentity(scope,id,r)
      await this.reconcileAttempts(scope,id,r)
      r.runner.until=now+leaseMs;r.updatedAt=iso(now)
      const value=work(r);await this.verifyIdentity(scope,id,r);await this.write(file,r);return value
    })
  }
}
export const restoreBatches=new RestoreBatches()
