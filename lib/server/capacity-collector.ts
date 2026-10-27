import {promises as fs} from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import {configStore,type VBRSource} from './config-store'
import {tokenManager} from './token-manager'
import {readCacheScope} from './read-cache-scope'
import {recordCapacity} from './capacity-history'
import {withFileLease} from './file-lease'
import {readOperationsCollection} from '../operations/load'
import {stateSchema} from '../repositories/model'
import {utilization} from '../operations/model'
import {COLLECTION_INTERVAL,collectorDue,presentCollector,type CollectorStatus} from '../forecast/collector'

const statusSchema=z.object({state:z.enum(['waiting','running','healthy','partial','error','disabled','unsupported','stale']),intervalMinutes:z.number(),lastAttempt:z.string().nullable(),lastSuccess:z.string().nullable(),nextAttempt:z.string().nullable(),repositories:z.number(),measured:z.number(),message:z.string()})
const directory=path.join(process.cwd(),'data','capacity-collector')
const enabled=()=>process.env.CAPACITY_COLLECTOR_ENABLED!=='false'
const statusPath=(scope:string)=>{if(!/^[a-f0-9]{64}$/.test(scope))throw new Error('Invalid collector scope');return path.join(directory,`${scope}.json`)}
async function readStatus(scope:string):Promise<CollectorStatus|null> {
  try{return statusSchema.parse(JSON.parse(await fs.readFile(statusPath(scope),'utf8')))}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error}
}
async function saveStatus(scope:string,status:CollectorStatus) {
  await fs.mkdir(directory,{recursive:true})
  const target=statusPath(scope),temporary=`${target}.${randomUUID()}.tmp`
  try{await fs.writeFile(temporary,JSON.stringify(status),{mode:0o600});await fs.rename(temporary,target)}finally{await fs.unlink(temporary).catch(()=>undefined)}
}
export function configuredScope(source:VBRSource) {
  const destination=new URL(`${source.protocol}://${source.host}:${source.port}`)
  if(!['https:','http:'].includes(destination.protocol))throw new Error('Unsupported source protocol')
  return {destination,scope:readCacheScope(destination.href,'',source)}
}

/** Fixed read capability: the collector cannot call job actions, rescan, or arbitrary URLs. */
export async function collectCapacitySource(source:VBRSource) {
  if(!enabled()||source.platform!=='vbr'||!source.password)return
  const {scope,destination}=configuredScope(source)
  await withFileLease(path.join(directory,`${scope}.lock`),5*60000,async()=>{
    const previous=await readStatus(scope),started=Date.now()
    if(!collectorDue(previous,started))return
    let status:CollectorStatus={state:'running',intervalMinutes:15,lastAttempt:new Date(started).toISOString(),lastSuccess:previous?.lastSuccess||null,nextAttempt:new Date(started+COLLECTION_INTERVAL).toISOString(),repositories:previous?.repositories||0,measured:previous?.measured||0,message:'Reading repository capacity from VBR.'}
    await saveStatus(scope,status)
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),60000)
    try {
      const checkSource=()=>{const current=configStore.getById(source.id);if(!current?.password||configuredScope(current).scope!==scope)throw new Error('Source configuration changed during collection. This reading was discarded.')}
      checkSource()
      let token=await tokenManager.getToken(source.id)
      if(!token)throw new Error('Saved credentials could not authenticate. Review this data source.')
      const read=async(endpoint:string)=>{
        const target=new URL(endpoint,destination)
        if(target.origin!==destination.origin||target.pathname!=='/api/v1/backupInfrastructure/repositories/states')throw new Error('Unsupported collector request.')
        const send=()=>{checkSource();return fetch(target,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json','x-api-version':'1.3-rev1'},cache:'no-store',redirect:'error',signal:controller.signal})}
        let response=await send()
        if(response.status===401){token=await tokenManager.refreshToken(source.id);if(token)response=await send()}
        if(!response.ok)throw new Error(response.status===401?'VBR authentication failed. Review the saved source credentials.':response.status===403?'The source account cannot read repository capacity.':'VBR repository capacity could not be read. The collector will retry on its next schedule.')
        return response.json()
      }
      const repositories=await readOperationsCollection(read,'/api/v1/backupInfrastructure/repositories/states',stateSchema)
      checkSource()
      await recordCapacity(scope,repositories.data)
      const measured=repositories.data.filter(r=>r.type!=='ScaleOut'&&utilization(r)!==null).length
      status={...status,state:repositories.complete?'healthy':'partial',lastSuccess:new Date().toISOString(),repositories:repositories.data.length,measured,message:repositories.complete?`${measured} repositories have measured capacity; ${repositories.data.length-measured} are unmeasured or aggregate records.`:'Repository inventory was partial. Only returned measurements were saved.'}
    }catch(error) {
      status={...status,state:'error',message:controller.signal.aborted?'Collection timed out. The next scheduled attempt will retry.':error instanceof Error&&/^(Saved credentials|VBR |The source account|Source configuration)/.test(error.message)?error.message:'Collection could not complete. Check source connectivity and app data-directory access.'}
    }finally{clearTimeout(timeout);controller.abort()}
    await saveStatus(scope,status)
  })
}

type Runtime={timer?:ReturnType<typeof setInterval>;busy:boolean;lastError?:string}
const globalCollector=globalThis as typeof globalThis & {capacityCollectorRuntime?:Runtime}
export function startCapacityCollector() {
  if(!enabled()||process.env.NEXT_PHASE==='phase-production-build')return
  const runtime=globalCollector.capacityCollectorRuntime ||= {busy:false}
  if(runtime.timer)return
  const tick=async()=>{
    if(runtime.busy||!enabled())return
    runtime.busy=true
    try {
      const ids=new Set(configStore.getAll().filter(s=>s.platform==='vbr').map(s=>s.id))
      if(configStore.getById('env-vbr')?.password)ids.add('env-vbr')
      const sources=[...ids];let cursor=0
      await Promise.all(Array.from({length:Math.min(2,sources.length)},async()=>{
        while(cursor<sources.length){const id=sources[cursor++];try{const source=configStore.getById(id);if(source)await collectCapacitySource(source)}catch{runtime.lastError='A collection could not be scheduled. Check app data-directory access.'}}
      }))
    }catch{runtime.lastError='Collector could not read saved source configuration.'}
    finally{runtime.busy=false}
  }
  runtime.timer=setInterval(()=>void tick(),60000);runtime.timer.unref()
  void tick()
}
export async function getCollectorStatus(scope:string,supported:boolean):Promise<CollectorStatus> {
  try{
    const stored=await readStatus(scope),status=presentCollector(stored,Date.now(),enabled(),supported)
    if(!stored&&enabled()&&supported&&globalCollector.capacityCollectorRuntime?.lastError)return {...status,state:'error',message:globalCollector.capacityCollectorRuntime.lastError}
    return status
  }
  catch{return {...presentCollector(null,Date.now(),enabled(),supported),state:'error',message:'Collector status could not be read. Check app data-directory access.'}}
}
