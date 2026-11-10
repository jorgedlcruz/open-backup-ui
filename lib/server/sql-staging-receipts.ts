// Open Backup UI v1.2.0
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {z} from 'zod'
import {withFileLease} from './file-lease'
import {sqlGuid,sqlScope,type SqlContext} from '../recovery/sql-protocol'
import {VbrRecoveryError} from '../recovery/error'

const entry=z.object({id:sqlGuid,sessionId:sqlGuid,sourceKey:sqlScope,principalKey:sqlScope,updated:z.number().int(),plan:z.string(),target:z.string(),enable:z.boolean(),
  phase:z.enum(['sending','validating','toggling','saved','failed']),taskId:sqlGuid.optional()})
export type SqlStagingReceipt=z.infer<typeof entry>

// Native settings are shared across profiles on the same Explorer gateway.
// Use the verified transport origin for locking, and bind receipt access to
// the source profile, operator and SQL mount that performed the write.
export class SqlStagingReceipts{
  constructor(private root=path.join(process.cwd(),'data','sql-staging')){}
  private file(ctx:SqlContext){
    const gateway=ctx.stagingGateway&&URL.canParse(ctx.stagingGateway)?new URL(ctx.stagingGateway):undefined
    if(gateway?.protocol!=='https:'||gateway.origin!==ctx.stagingGateway)throw new VbrRecoveryError('Invalid VBR web console configuration.',503)
    const key=createHash('sha256').update('vesql-staging:'+gateway.origin).digest('hex')
    return path.join(this.root,key+'.json')
  }
  async read(ctx:SqlContext){
    try{return entry.parse(JSON.parse(await fs.readFile(this.file(ctx),'utf8')))}
    catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e}
  }
  async write(ctx:SqlContext,value:SqlStagingReceipt){
    const file=this.file(ctx),tmp=file+'.'+randomUUID()
    try{await fs.writeFile(tmp,JSON.stringify(entry.parse(value)),{mode:0o600,flag:'wx'});await fs.rename(tmp,file)}
    finally{await fs.unlink(tmp).catch(()=>{})}
  }
  async exclusive<T>(ctx:SqlContext,work:()=>Promise<T>):Promise<T>{
    const result=await withFileLease(this.file(ctx)+'.lock',300_000,work)
    if(result===null)throw new VbrRecoveryError('SQL staging settings are being updated. Reload their status.',409)
    return result
  }
}
export const sqlStagingReceipts=new SqlStagingReceipts()
