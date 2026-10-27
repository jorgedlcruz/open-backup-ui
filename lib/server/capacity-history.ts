import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { mergeObservations } from '../forecast/history'
import type { Observation } from '../forecast/model'
import type { OperationRepository } from '../operations/model'
import {withFileLease} from './file-lease'

const schema = z.array(z.object({id:z.string(),at:z.string(),capacityGB:z.number().finite(),freeGB:z.number().finite()})).max(20000)
const globalHistory=globalThis as typeof globalThis & {capacityHistoryQueues?:Map<string,Promise<Observation[]>>}
const queues = globalHistory.capacityHistoryQueues ||= new Map<string,Promise<Observation[]>>()
export async function recordCapacity(scope:string, repositories:OperationRepository[]):Promise<Observation[]> {
  if(!/^[a-f0-9]{64}$/.test(scope)) throw new Error('Invalid history scope')
  const directory=path.join(process.cwd(),'data','capacity-history'), file=path.join(directory,`${scope}.json`)
  const previous=queues.get(scope)
  const work=(async()=>{
    if(previous) await previous.catch(()=>undefined)
    for(let attempt=0;attempt<20;attempt++) {
      const result=await withFileLease(`${file}.lock`,30000,async()=>{
        await fs.mkdir(directory,{recursive:true})
        let rows:Observation[]=[]
        try { rows=schema.parse(JSON.parse(await fs.readFile(file,'utf8'))) }
        catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error }
        rows=mergeObservations(rows,repositories,Date.now())
        const temporary=path.join(directory,`${scope}.${randomUUID()}.tmp`)
        try { await fs.writeFile(temporary,JSON.stringify(rows),{mode:0o600}); await fs.rename(temporary,file) }
        finally { await fs.unlink(temporary).catch(()=>undefined) }
        return rows
      })
      if(result!==null)return result
      await new Promise(resolve=>setTimeout(resolve,100))
    }
    throw new Error('Capacity history is busy')
  })()
  queues.set(scope,work)
  try{return await work}finally{if(queues.get(scope)===work)queues.delete(scope)}
}
