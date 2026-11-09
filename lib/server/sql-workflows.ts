// Open Backup UI v1.0.2
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {withFileLease} from './file-lease'
import {VbrRecoveryError} from '../recovery/error'
import {sqlGuid,sqlScope,type SqlContext} from '../recovery/sql-protocol'
import type {sqlIntentSchema,SqlDatabase,SqlStep} from '../recovery/sql-actions'
import type {z} from 'zod'

export type SqlIntent=z.infer<typeof sqlIntentSchema>
export type SqlJob={jobId:string;database:SqlDatabase}
export type SqlCheckStamp={nonce:string;digest:string;existing?:boolean;pointInTime?:boolean}
export type SqlFlow={
  id:string;sessionId:string;intent:SqlIntent;databases:SqlDatabase[];ranges:({from?:string|null;to?:string|null}|null)[]
  published?:string[];state:'open'|'submitted'|'uncertain'|'canceled';created:number
  checks:Partial<Record<SqlStep,SqlCheckStamp>>
  inputs?:Partial<Record<SqlStep,string>>
  pending?:{nonce:string;step:SqlStep|'submit'|'cancel';digest:string;pointInTime?:boolean;taskId?:string}
  jobs?:SqlJob[]; submission?:string
}
const absent=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT'
export class SqlWorkflows {
  constructor(private base=path.join(process.cwd(),'data','sql-workflows')){}
  private directory(ctx:SqlContext,sessionId:string){
    return path.join(this.base,sqlScope.parse(ctx.sourceKey),sqlScope.parse(ctx.principalKey),sqlGuid.parse(sessionId))
  }
  async create(ctx:SqlContext,flow:SqlFlow) {
    const dir=this.directory(ctx,flow.sessionId)
    await fs.mkdir(dir,{recursive:true,mode:0o700})
    const file=path.join(dir,sqlGuid.parse(flow.id)+'.json')
    await fs.writeFile(file,JSON.stringify(flow),{flag:'wx',mode:0o600})
  }
  async read(ctx:SqlContext,session:string,id:string):Promise<SqlFlow> {
    try{
      const f:SqlFlow=JSON.parse(await fs.readFile(path.join(this.directory(ctx,session),sqlGuid.parse(id)+'.json'),'utf8'))
      if(f.id===id && f.sessionId===session && Array.isArray(f.databases) && f.checks)return f
    }catch(error){if(!absent(error))throw error}
    throw new VbrRecoveryError('This SQL workflow is unavailable. Reopen the operation.',409)
  }
  async update<T>(ctx:SqlContext,session:string,id:string,change:(flow:SqlFlow)=>T) {
    const file=path.join(this.directory(ctx,session),sqlGuid.parse(id)+'.json')
    for(let n=0;n<20;n++) {
      const value=await withFileLease(file+'.lock',30_000,async()=>{
        const flow=await this.read(ctx,session,id),result=change(flow)
        const temp=file+'.'+randomUUID()
        try{await fs.writeFile(temp,JSON.stringify(flow),{flag:'wx',mode:0o600});await fs.rename(temp,file)}
        finally{await fs.unlink(temp).catch(()=>{})}
        return {result}
      })
      if(value)return value.result
      await new Promise(resolve=>setTimeout(resolve,30+Math.random()*30))
    }
    throw new VbrRecoveryError('This SQL workflow is busy. Refresh its status.',409)
  }
  async jobs(ctx:SqlContext,session:string) {
    let files:string[]
    try{files=await fs.readdir(this.directory(ctx,session))}catch(error){if(absent(error))return [];throw error}
    const rows:{workflowId:string;intent:SqlIntent;job:SqlJob}[]=[]
    for(const file of files) {
      const id=file.slice(0,-5)
      if(!file.endsWith('.json') || !sqlGuid.safeParse(id).success)continue
      const flow=await this.read(ctx,session,id)
      for(const job of flow.jobs||[])rows.push({workflowId:id,intent:flow.intent,job})
    }
    return rows
  }
}
export const sqlWorkflows=new SqlWorkflows()
