// Open Backup UI v1.0.2
import {createHmac,randomUUID} from 'node:crypto'
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {z} from 'zod'
import {VbrRecoveryError} from '../recovery/error'

const receipt=z.object({sessionId:z.string().uuid(),name:z.string().optional(),status:z.string().optional()})
type Receipt=z.infer<typeof receipt>
type Context={secret:string;sourceKey:string;principalKey:string}
const uncertain=()=>new VbrRecoveryError('The previous Explorer submission has no confirmed result. Check Sessions before trying again.',409,true)
const code=(error:unknown)=>(error as NodeJS.ErrnoException).code

export class AdSubmissions {
  constructor(private base=path.join(process.cwd(),'data','ad-submissions')){}
  async submit(ctx:Context,sessionId:string,workflowId:string,intent:string,review:unknown,run:()=>Promise<Receipt>):Promise<Receipt> {
    const seal=(values:unknown[])=>createHmac('sha256',ctx.secret).update(JSON.stringify(values)).digest('hex')
    const key=seal(['vead/final',ctx.sourceKey,ctx.principalKey,sessionId,workflowId])
    const fingerprint=seal([key,intent,review])
    const directory=path.join(this.base,key),file=path.join(directory,'accepted.json')
    await fs.mkdir(this.base,{recursive:true,mode:0o700})
    // The exclusive directory survives process restarts and a dropped HTTP request.
    // Only the process that created it may issue the native final POST.
    try{await fs.mkdir(directory,{mode:0o700})}catch(error){
      if(code(error)!=='EEXIST')throw error
      let stored
      try{stored=z.object({fingerprint:z.string(),receipt}).parse(JSON.parse(await fs.readFile(file,'utf8')))}
      catch{throw uncertain()}
      if(stored.fingerprint!==fingerprint)throw new VbrRecoveryError('This Explorer workflow has already been submitted. Check Sessions.',409)
      return stored.receipt
    }
    let accepted:Receipt
    try{accepted=receipt.parse(await run())}catch(error){
      if(error instanceof VbrRecoveryError && !error.uncertain && [400,401,403,404,409,415,422].includes(error.status)){
        await fs.rmdir(directory)
      }
      throw error
    }
    const tmp=path.join(directory,randomUUID()+'.tmp')
    try{
      await fs.writeFile(tmp,JSON.stringify({fingerprint,receipt:accepted}),{flag:'wx',mode:0o600})
      await fs.rename(tmp,file)
    }catch{throw uncertain()}
    finally{await fs.unlink(tmp).catch(()=>{})}
    return accepted
  }
}
export const adSubmissions=new AdSubmissions()
