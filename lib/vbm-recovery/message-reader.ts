// Open Backup UI v1.3.0
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { RecoveryError } from './model'

let activeParsers=0

export type MessageBody = {format:'text'|'html'|'unavailable';content:string;truncated:boolean}

export async function readMessageBody(bytes:Uint8Array<ArrayBuffer>,signal:AbortSignal):Promise<MessageBody> {
  const unavailable:MessageBody={format:'unavailable',content:'',truncated:false}
  if(bytes[0]!==0xd0 || bytes[1]!==0xcf || bytes[2]!==0x11 || bytes[3]!==0xe0) return unavailable
  signal.throwIfAborted()
  if(activeParsers>=2)throw new RecoveryError('Preview unavailable',429)
  return new Promise((resolve,reject)=>{
    const worker=new Worker(path.join(process.cwd(),'lib','vbm-recovery','read-msg-body.cjs'),{
      workerData:bytes.buffer,transferList:[bytes.buffer],
      resourceLimits:{maxOldGenerationSizeMb:64,maxYoungGenerationSizeMb:16,stackSizeMb:2},
    })
    activeParsers++
    const abort=()=>{finish();reject(signal.reason)}
    const timer=setTimeout(()=>{finish();resolve(unavailable)},5000)
    function finish(){
      clearTimeout(timer)
      signal.removeEventListener('abort',abort)
      void worker.terminate()
    }
    worker.once('message',(body:MessageBody)=>{finish();resolve(body)})
    worker.once('error',()=>{finish();resolve(unavailable)})
    worker.once('exit',()=>{activeParsers--;clearTimeout(timer);signal.removeEventListener('abort',abort);resolve(unavailable)})
    signal.addEventListener('abort',abort,{once:true})
    if(signal.aborted)abort()
  })
}
