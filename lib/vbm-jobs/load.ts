import { z } from 'zod'
import { collection, VbmRequestError, type Reader } from '../vbm-dashboard/load'
import { organizationSchema,repositorySchema,type Evidence } from '../vbm-dashboard/model'
import { validId } from '../investigation/model'
import { backupJobSchema,backupSessionSchema,logSchema,type JobsSnapshot,type SessionDetail,type Window } from './model'

function assertId(id:string) {if(!validId(id))throw new VbmRequestError('Invalid Microsoft 365 resource ID.',400)}
function bounded(raw:Reader):Reader {
  let active=0;const queue:(()=>void)[]=[]
  return async path=>{if(active>=4)await new Promise<void>(resolve=>queue.push(resolve));active++;try{return await raw(path)}finally{active--;queue.shift()?.()}}
}
export async function loadJobs(raw:Reader,sourceName:string,window:Window,jobId?:string,now=new Date()):Promise<JobsSnapshot> {
  if(jobId)assertId(jobId)
  jobId=jobId?.toLowerCase()
  const read=bounded(raw),warnings:string[]=[]
  const collect=async<T extends {id:string}>(label:string,path:string,schema:z.ZodType<T>,max=5000)=>{
    const result=await collection(read,path,schema,row=>row.id,max)
    if(!result.complete)warnings.push(`${label}: ${result.available ? 'partial collection':'unavailable'}. ${result.error || 'Only loaded records are counted.'}`)
    return result
  }
  const params=new URLSearchParams()
  if(jobId)params.set('jobId',jobId)
  if(window!=='all')params.set('endTimeLowerBound',new Date(now.getTime()-Number(window)*86400000).toISOString())
  const jobsPromise=jobId ? (async()=>{
    try {
      const job=backupJobSchema.parse(await read(`/v8/Jobs/${jobId}`))
      if(job.id!==jobId)throw new VbmRequestError('The server returned a different job.',502)
      return {data:[job],available:true,complete:true}
    }catch(error){if(error instanceof VbmRequestError && [400,401].includes(error.status))throw error;warnings.push('Job configuration unavailable. Retained sessions can still be investigated.');return {data:[],available:false,complete:false,error:'Job configuration could not be read.'}}
  })():collect('Jobs','/v8/Jobs',backupJobSchema)
  const [jobs,sessions,repositories,organizations]=await Promise.all([
    jobsPromise,collect('Sessions',`/v8/JobSessions?${params}`,backupSessionSchema,10000),
    collect('Repositories','/v8/BackupRepositories',repositorySchema),collect('Organizations','/v8/Organizations',organizationSchema),
  ])
  if(!jobs.available && !sessions.available)throw new VbmRequestError('Microsoft 365 jobs and sessions could not be read. Check the connection and permissions.',502)
  if(jobId && sessions.data.some(session=>session.jobId!==jobId)) {
    sessions.data=sessions.data.filter(session=>session.jobId===jobId)
    sessions.complete=false;warnings.push('The source returned sessions outside this job. Only matching job IDs are shown.')
  }
  return {sourceName,fetchedAt:now.toISOString(),window,jobId,jobs,sessions,repositories,organizations,warnings}
}
export async function loadSession(read:Reader,sourceName:string,id:string,jobId:string,now=new Date()):Promise<SessionDetail> {
  assertId(id);assertId(jobId)
  const session=backupSessionSchema.parse(await read(`/v8/JobSessions/${id}`))
  if(session.id!==id.toLowerCase() || session.jobId!==jobId.toLowerCase())throw new VbmRequestError('This session does not belong to the selected job.',404)
  const path=`/v8/JobSessions/${encodeURIComponent(id)}/LogItems?orderAsc=false`
  let logs:Evidence<z.infer<typeof logSchema>>=await collection(read,path,logSchema,row=>row.id,10000)
  const warnings:string[]=[]
  if(!logs.complete) {
    warnings.push(`Session log: ${logs.available ? 'partial':'unavailable'}. ${logs.error || 'Only loaded entries are shown.'}`)
    // A large session can bury earlier errors: request severity collections independently.
    const issues=await Promise.all(['Error','Warning'].map(type=>collection(read,`${path}&type=${type}`,logSchema,row=>row.id,5000)))
    const merged=new Map(logs.data.map(row=>[row.id,row]))
    issues.forEach(result=>result.data.forEach(row=>merged.set(row.id,row)))
    logs={...logs,data:[...merged.values()],available:logs.available || issues.some(result=>result.available)}
    warnings.push(issues.every(result=>result.complete) ? 'Errors and warnings were additionally read in full; the complete log remains partial.' : 'Error and warning counts may also be partial.')
  }
  return {sourceName,fetchedAt:now.toISOString(),session,logs,warnings}
}
