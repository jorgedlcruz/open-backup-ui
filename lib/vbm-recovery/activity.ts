// Open Backup UI v1.3.0
import { z } from 'zod'
import { RecoveryError,record } from './model'
import type { Execute } from './transport'

export type RecoveryActivity={runningJobs:number;hasMore:boolean;checkedAt:string}
const pageSize=200
const jobSession=z.object({id:z.string().uuid(),jobId:z.string().uuid(),jobType:z.enum(['Backup','Copy']),status:z.string().min(1)})

/** One server-filtered page, not a tenant-wide history scan or one call per job. */
export async function loadRecoveryActivity(execute:Execute,now=new Date()):Promise<RecoveryActivity> {
  const raw=record(await execute(`/v8/JobSessions?${new URLSearchParams({status:'Running',offset:'0',limit:String(pageSize)})}`))
  const parsed=z.array(jobSession).safeParse(raw.results)
  if(!parsed.success)throw new RecoveryError('Recovery information could not be loaded.',502)
  const jobs=new Set(parsed.data.filter(session=>session.status==='Running').map(session=>session.jobId))
  return {runningJobs:jobs.size,hasMore:!!record(raw._links).next||parsed.data.length>=pageSize,checkedAt:now.toISOString()}
}

/** Scope includes configured source and authenticated principal; a failed read never becomes zero jobs. */
export function createRecoveryActivityCache(now:()=>number=Date.now,ttl=30000) {
  const snapshots=new Map<string,{value:RecoveryActivity;expiresAt:number}>()
  const pending=new Map<string,Promise<RecoveryActivity>>()
  return (execute:Execute,scope:string):Promise<RecoveryActivity>=>{
    const time=now(),cached=snapshots.get(scope)
    if(cached&&cached.expiresAt>time)return Promise.resolve(cached.value)
    const active=pending.get(scope)
    if(active)return active
    const request=loadRecoveryActivity(execute,new Date(time)).then(value=>{
      const finished=now()
      // Keep the actual observation time, and let simultaneous refreshes share this short snapshot.
      const observed={...value,checkedAt:new Date(finished).toISOString()}
      for(const [key,entry] of snapshots)if(entry.expiresAt<=finished)snapshots.delete(key)
      snapshots.delete(scope);snapshots.set(scope,{value:observed,expiresAt:finished+ttl})
      while(snapshots.size>32)snapshots.delete(snapshots.keys().next().value!)
      return observed
    }).finally(()=>pending.delete(scope))
    pending.set(scope,request)
    return request
  }
}

export const recoveryActivity=createRecoveryActivityCache()
