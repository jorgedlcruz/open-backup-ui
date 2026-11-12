// Open Backup UI v1.2.0
import {createHash,randomUUID} from 'node:crypto'
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {z} from 'zod'
import {VbrRecoveryError} from '../recovery/error'
import {browsePage,browsePayload,pageRequest,sqlGuid,type SqlContext} from '../recovery/sql-protocol'
import {withFileLease} from './file-lease'
import type {RecoverySend} from './vbr-recovery'

const base='/private-api/v1/backupBrowser/applicationItems/vesql/'
const request=z.object({requestId:sqlGuid,taskId:sqlGuid.optional(),started:z.number(),seen:z.number()})
const status=z.object({id:sqlGuid,type:z.literal('Common'),state:z.string(),result:z.string().nullish(),
  additionalInfo:z.object({message:z.string().nullish()}).nullish()})
const abandonedMs=12_000,missingTaskMs=65_000,maxTaskMs=10*60_000
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
const absent=(err:unknown)=>(err as NodeJS.ErrnoException).code==='ENOENT'
async function check(send:RecoverySend,id:string) {
  const task=status.parse(await send('/private-api/v1/tasks/'+id))
  if(task.id!==id)throw new VbrRecoveryError('VBR returned a different Explorer task.',502)
  return task
}
async function save(file:string,row:object) {
  const tmp=file+'.'+randomUUID()
  try{await fs.writeFile(tmp,JSON.stringify(row),{flag:'wx',mode:0o600});await fs.rename(tmp,file)}
  finally{await fs.unlink(tmp).catch(()=>{})}
}
// The private VESQL result endpoint serves the mount's LAST search, even when
// asked for another completed task's GUID. Hold the mount across POST, terminal
// status and result GET. Only cursor ownership is stored, never database rows.
export class SqlBrowseCursor {
  constructor(private directory=path.join(process.cwd(),'data','sql-browse-cursors')){}
  async read(send:RecoverySend,ctx:SqlContext,input:z.infer<typeof pageRequest>,requestId:string,queuedAt:number) {
    const key=createHash('sha256').update(JSON.stringify([ctx.sourceKey,input.sessionId])).digest('hex')
    const file=path.join(this.directory,key+'.json'),url=base+input.sessionId
    const owner=sqlGuid.parse(requestId)
    return withFileLease(file+'.lock',5*60_000,async()=>{
      const stale=()=>new VbrRecoveryError('This SQL browse page expired. Refresh the page.',409)
      if(Date.now()-queuedAt>maxTaskMs)throw stale()
      const completed=file+'.completed'
      const stamps=z.object({retired:z.number(),rows:z.array(z.object({id:sqlGuid,at:z.number()}))})
      let recent:z.infer<typeof stamps>={retired:0,rows:[]}
      try{recent=stamps.parse(JSON.parse(await fs.readFile(completed,'utf8')))}catch(err){if(!absent(err))throw err}
      if(queuedAt<=recent.retired || recent.rows.some(stamp=>stamp.id===owner))throw stale()
      async function retire() {
        recent.rows=recent.rows.filter(stamp=>Date.now()-stamp.at<=maxTaskMs)
        recent.rows.push({id:owner,at:queuedAt})
        while(recent.rows.length>256)recent.retired=Math.max(recent.retired,recent.rows.shift()!.at)
        await save(completed,recent)
      }
      let row:z.infer<typeof request>|undefined
      try {row=request.parse(JSON.parse(await fs.readFile(file,'utf8')))}
      catch(err){if(!absent(err))throw err}
      if(row) {
        const age=Date.now()-row.started
        if(!row.taskId && age<missingTaskMs)return null
        if(row.requestId!==owner && age<maxTaskMs) {
          if(Date.now()-row.seen<abandonedMs)return null
          if(row.taskId){
            // A disconnected tab may leave a native search in flight. Wait for
            // its terminal status before reusing this mount's result buffer.
            try{if((await check(send,row.taskId)).state!=='Stopped')return null}
            catch(err){if(!(err instanceof VbrRecoveryError && err.status===404))throw err}
          }
        }
        if(!row.taskId||row.requestId!==owner||age>=maxTaskMs)row=undefined
      }
      if(!row){
        const now=Date.now()
        row={requestId:owner,started:now,seen:now}
        await save(file,row)
        try {
          const found=await send(url+'?skip='+input.skip+'&limit='+input.limit,{method:'POST',mutation:true,body:browsePayload(input.view,input.parent)})
          row.taskId=z.object({id:sqlGuid}).parse(found).id
          await save(file,row)
        }catch(err){
          // Confirmed rejection created no search. A dropped POST can still be
          // running in VBR, so leave the bounded provisional cursor in that case.
          if(err instanceof VbrRecoveryError && !err.uncertain && err.status<500)await fs.unlink(file)
          throw err
        }
      }
      const taskId=row.taskId!
      const end=Date.now()+2500
      for(;;) {
        let task
        try {task=await check(send,taskId)}
        catch(err){if(err instanceof VbrRecoveryError && err.status===404)await fs.unlink(file);throw err}
        if(task.state==='Stopped') {
          try{
            if(!['Success','Warning'].includes(task.result||''))throw new VbrRecoveryError(task.additionalInfo?.message||'The VBR Explorer task did not complete successfully.',409)
            return browsePage(ctx,input,await send(url+'/'+taskId+'/result'))
          }finally{await retire();await fs.unlink(file)}
        }
        if(Date.now()>=end){row.seen=Date.now();await save(file,row);return null}
        await delay(200)
      }
    })
  }
}
export const sqlBrowseCursor=new SqlBrowseCursor()
