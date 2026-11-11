// Open Backup UI v1.2.0
import {createHash,randomUUID} from 'node:crypto'
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {z} from 'zod'
import {VbrRecoveryError} from '../recovery/error'
import {replaceFile} from './atomic-file'

const receipt=z.object({id:z.string().uuid(),sessionId:z.string().uuid().optional(),taskId:z.string().uuid().optional(),taskKey:z.string().optional(),
  kind:z.string().optional()})
export type DataReceipt=z.infer<typeof receipt>
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const uncertain=()=>new VbrRecoveryError('VBR could not confirm the operation. Check Sessions before trying again.',409,true)
const operation=z.object({sessionId:z.string().uuid(),view:z.enum(['browse','instant']).default('browse'),action:z.enum(['copy','restore'])})
type Operation=z.infer<typeof operation>
const sameOperation=(a:Operation,b:Operation)=>a.sessionId===b.sessionId&&a.view===b.view&&a.action===b.action
export class UnstructuredReceipts {
  private pending=new Set<string>()
  constructor(private directory=path.join(process.cwd(),'data','unstructured-recovery')){}
  async operationStatus(source:string,principal:string,id:string,expected:Operation){
    const owner=path.join(this.directory,digest([source,principal,id]))
    try{
      const saved=z.object({result:receipt,operation:operation.optional()}).parse(JSON.parse(await fs.readFile(path.join(owner,'result.json'),'utf8')))
      if(!saved.operation||!sameOperation(saved.operation,expected)||!saved.result.taskId||!saved.result.taskKey)return {phase:'missing'} as const
      return {phase:'accepted',...saved.result} as const
    }catch(error){
      if((error as NodeJS.ErrnoException).code!=='ENOENT')return {phase:'unknown'} as const
    }
    try{
      const saved=z.object({operation}).parse(JSON.parse(await fs.readFile(path.join(owner,'pending.json'),'utf8')))
      if(!sameOperation(saved.operation,expected))return {phase:'missing'} as const
      return {phase:this.pending.has(owner)?'pending':'unknown'} as const
    }catch(error){return {phase:(error as NodeJS.ErrnoException).code==='ENOENT'?'missing':'unknown'} as const}
  }
  async launchStatus(source:string,principal:string,id:string,kind:string){
    const owner=path.join(this.directory,digest([source,principal,id]))
    try{
      const decoded=z.object({result:receipt}).parse(JSON.parse(await fs.readFile(path.join(owner,'result.json'),'utf8')))
      const result=decoded.result
      if(result.kind===kind&&result.sessionId===result.id)return {phase:'accepted',sessionId:result.sessionId} as const
      return {phase:'unknown'} as const
    }catch(e){
      if((e as NodeJS.ErrnoException).code!=='ENOENT')throw uncertain()
      // Missing and unfinished both mean VBR has not confirmed this request.
      return {phase:'unknown'} as const
    }
  }
  async submit(source:string,principal:string,id:string,command:unknown,run:()=>Promise<DataReceipt>){
    const owner=path.join(this.directory,digest([source,principal,id])),fingerprint=digest(command),file=path.join(owner,'result.json')
    const association=operation.safeParse(command).data,pendingFile=path.join(owner,'pending.json')
    await fs.mkdir(this.directory,{recursive:true,mode:0o700})
    try{await fs.mkdir(owner,{mode:0o700})}catch(err){
      if((err as NodeJS.ErrnoException).code!=='EEXIST')throw err
      let previous
      try{previous=z.object({fingerprint:z.string(),result:receipt}).parse(JSON.parse(await fs.readFile(file,'utf8')))}catch{throw uncertain()}
      if(previous.fingerprint!==fingerprint)throw new VbrRecoveryError('This request already belongs to a different recovery.',409)
      return previous.result
    }
    this.pending.add(owner)
    try{
      // Persist only the association before sending a mutation, never credentials
      // or a command that could accidentally be replayed by receipt recovery.
      if(association)await fs.writeFile(pendingFile,JSON.stringify({operation:association}),{flag:'wx',mode:0o600})
      let result:DataReceipt
      try{result=receipt.parse(await run())}catch(error){
        if(error instanceof VbrRecoveryError&&!error.uncertain&&[400,401,403,404,409,422].includes(error.status)){
          await fs.unlink(pendingFile).catch(()=>{});await fs.rmdir(owner).catch(()=>{})
        }
        throw error
      }
      const tmp=path.join(owner,randomUUID()+'.tmp')
      try{await fs.writeFile(tmp,JSON.stringify({fingerprint,result,...(association?{operation:association}:{})}),{flag:'wx',mode:0o600});await replaceFile(tmp,file)}catch{throw uncertain()}
      finally{await fs.unlink(tmp).catch(()=>{})}
      await fs.unlink(pendingFile).catch(()=>{})
      return result
    }finally{this.pending.delete(owner)}
  }
}
export const unstructuredReceipts=new UnstructuredReceipts()
