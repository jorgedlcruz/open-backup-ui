import { z } from 'zod'
import { jobSchema, sessionSchema, jobMatches, status, type Evidence, type Snapshot, type JobIssue } from '../vbm-dashboard/model'
import { time, validId } from '../investigation/model'

const text = z.string().nullish()
const ref = text.transform(value => value?.toLowerCase())
const number = z.union([z.number(),z.string()]).nullish().transform(value => {
  const n = typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER ? n : null
})
export const backupJobSchema = jobSchema.extend({schedulePolicy: z.object({
  scheduleEnabled:z.boolean().nullish(), type:text, dailyType:text, dailyTime:text,
  retryEnabled:z.boolean().nullish(), retryNumber:number, retryWaitInterval:number,
  backupWindowEnabled:z.boolean().nullish(), periodicallyWindowEnabled:z.boolean().nullish(),
}).nullish()})
export const backupSessionSchema = sessionSchema.extend({proxyId:ref,proxyPoolId:ref,jobSessionConfigType:text})
export const logSchema = z.object({id:z.string().min(1).transform(value=>value.toLowerCase()),usn:number,type:text,message:text,creationTime:text,endTime:text})
export type Job = z.infer<typeof backupJobSchema>
export type Session = z.infer<typeof backupSessionSchema>
export type Log = z.infer<typeof logSchema>
export type Window = '7'|'30'|'all'
export type JobsSnapshot = Pick<Snapshot,'sourceName'|'fetchedAt'|'warnings'|'organizations'|'repositories'> & {
  window:Window; jobId?:string; jobs:Evidence<Job>; sessions:Evidence<Session>
}
export type SessionDetail = {sourceName:string;fetchedAt:string;session:Session;logs:Evidence<Log>;warnings:string[]}
export const windowLabel = (window:Window) => window==='all' ? 'All retained history' : `Last ${window} days`
export const countLabel = (evidence:Evidence<unknown>,count=evidence.data.length) => evidence.available ? `${count.toLocaleString()}${evidence.complete ? '':'+'}`:'Unknown'
export const lookup = (rows:{id:string;name?:string|null}[],id?:string|null) => rows.find(row=>row.id===id)?.name || id || 'Not reported'
export type JobFilters = {query:string;issue:JobIssue;organizations:string[];repository:string;type:string}
export function filterJobs(data:JobsSnapshot,filters:JobFilters) {
  const query=filters.query.trim().toLowerCase()
  return data.jobs.data.filter(job=>jobMatches(job,filters.issue)
    && (!filters.organizations.length || filters.organizations.includes(job.organizationId || ''))
    && (filters.repository==='all' || job.repositoryId===filters.repository)
    && (filters.type==='all' || job.backupType===filters.type)
    && [job.name,job.description,job.id,lookup(data.organizations.data,job.organizationId),lookup(data.repositories.data,job.repositoryId)].join(' ').toLowerCase().includes(query))
}
export function duration(session:Session) {
  const start=time(session.creationTime),end=time(session.endTime)
  if(start===null || end===null || end<start) return status(session.status)==='Running' ? 'In progress':'Not reported'
  const seconds=Math.floor((end-start)/1000)
  return `${seconds>=3600 ? `${Math.floor(seconds/3600)}h `:''}${Math.floor(seconds%3600/60)}m ${seconds%60}s`
}
// Relations come only from explicit, valid mainSessionId references in the same job.
export function retryChain(selected:Session,rows:Session[]) {
  if(!validId(selected.jobId))return []
  const root=validId(selected.mainSessionId) ? selected.mainSessionId : selected.id
  const linked=rows.filter(row=>row.jobId===selected.jobId && (row.id===root || row.mainSessionId===root))
  if(!linked.some(row=>validId(row.mainSessionId)))return []
  return linked.sort((a,b)=>(time(a.creationTime) ?? Infinity)-(time(b.creationTime) ?? Infinity) || a.id.localeCompare(b.id))
}
export const logIssue=(log:Log)=>['Error','Warning','Failed'].includes(log.type || '')
export const workloads=['Exchange','OneDrive','SharePoint','Teams','Other / session'] as const
export type Workload=typeof workloads[number]
// This is a message classification, not an API object identity or a tenant protection count.
export function workload(log:Log):Workload {
  const message=(log.message || '').replace(/https?:\/\/\S+/gi,'')
  const matches:Workload[]=[]
  if(/\b(?:onedrive|one drive)\b/i.test(message))matches.push('OneDrive')
  if(/\b(?:exchange|mailbox|mailboxes)\b/i.test(message))matches.push('Exchange')
  if(/\b(?:sharepoint|site collection|processing site)\b/i.test(message))matches.push('SharePoint')
  if(/\b(?:teams|team site|team posts|team channels|processing team)\b/i.test(message))matches.push('Teams')
  return matches.length===1 ? matches[0]:'Other / session'
}
export function workloadTarget(log:Log) {
  if(workload(log)==='Other / session')return null
  const message=log.message || ''
  const processing=message.match(/processing (?:onedrive|mailbox|site|team)(?:\s*:?\s+)(.+)$/i)
  if(processing)return processing[1]
  return message.match(/https?:\/\/[^\s)]+/i)?.[0] || message.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] || null
}
export type LogFilters={query:string;severity:string;workload:string;order:'oldest'|'newest'}
export function filterLogs(rows:Log[],filters:LogFilters) {
  return rows.filter(row=>(filters.severity==='all' || (filters.severity==='issues' ? logIssue(row):(row.type || 'Not reported')===filters.severity))
    && (filters.workload==='all' || workload(row)===filters.workload)
    && [row.id,row.message,row.type].join(' ').toLowerCase().includes(filters.query.trim().toLowerCase()))
    .sort((a,b)=>{
      const at=time(a.creationTime),bt=time(b.creationTime)
      if(at===null)return bt===null ? a.id.localeCompare(b.id):1
      if(bt===null)return -1
      return (at-bt || (a.usn ?? 0)-(b.usn ?? 0) || a.id.localeCompare(b.id))*(filters.order==='oldest' ? 1:-1)
    })
}
export const actions=['start','stop','enable','disable'] as const
export type JobAction=typeof actions[number]
export function actionPath(id:string,action:JobAction) {
  if(!validId(id) || !actions.includes(action))throw new Error('Invalid job action')
  return `/v8/Jobs/${encodeURIComponent(id)}/${action}`
}
