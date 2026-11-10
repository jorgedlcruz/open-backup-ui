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
    reclaim(r,this.now());return receipt(r)
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
    const digest=createHash('sha256').update(JSON.stringify(input.items.map(({objectId,draft})=>({objectId,draft})))).digest('hex')
    return this.locked(file,async()=>{
      const existing=await this.load(file)
      if(existing){if(existing.digest!==digest)throw new VbrRecoveryError('This batch ID already belongs to a different recovery request.',409)
        reclaim(existing,this.now());return {receipt:receipt(existing),runner:undefined}}
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
      const now=this.now();reclaim(record,now)
      if(record.runner||!record.rows.some(r=>r.item.status==='notStarted'))return {receipt:receipt(record),runner:undefined}
      const runner=randomUUID();record.runner={id:runner,until:now+leaseMs};record.updatedAt=iso(now)
      for(const {item} of record.rows)if(item.status==='notStarted'){item.status='queued';delete item.message}
      await this.write(file,record);return {receipt:receipt(record),runner}
    })
  }
  async update<T>(scope:BatchScope,id:string,runner:string,work:(record:Record)=>T){
    const file=this.file(scope,id)
    return this.locked(file,async()=>{
      const r=await this.load(file),now=this.now()
      if(!r||r.runner?.id!==runner||r.runner.until<=now)throw new VbrRecoveryError('This recovery worker is no longer active.',409)
      r.runner.until=now+leaseMs;r.updatedAt=iso(now)
      const value=work(r);await this.write(file,r);return value
    })
  }
}
export const restoreBatches=new RestoreBatches()
