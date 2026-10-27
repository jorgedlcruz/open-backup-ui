import {activityBuckets,capacitySummary,isRunning,needsAttention,repositoryRisk,sessionSummary,utilization,type OperationsSnapshot} from '../operations/model'

export function lensPreviews(snapshot:OperationsSnapshot|null) {
  if(!snapshot)return null
  const sessions=snapshot.sessions.available?sessionSummary(snapshot):null
  const buckets=sessions?activityBuckets(snapshot):[]
  // Fold the entire selected window into twelve bars; no sessions are dropped.
  const activity=Array.from({length:Math.min(12,buckets.length)},()=>({Success:0,Warning:0,Failed:0}))
  buckets.forEach((bucket,index)=>{const target=activity[Math.floor(index*activity.length/buckets.length)];for(const status of ['Success','Warning','Failed'] as const)target[status]+=bucket[status]})
  const jobs=snapshot.jobs.available?snapshot.jobs.data:null
  const repositories=snapshot.repositories.available?snapshot.repositories.data:null
  const attention=jobs?.filter(needsAttention)
  const risks=['Offline','Critical','Low space','Outdated']
  const ranked=repositories?[...repositories].sort((a,b)=>{
    const rank=(r:typeof a)=>[...risks,'Unknown','Healthy'].indexOf(repositoryRisk(r))
    return rank(a)-rank(b)||(utilization(b)??-1)-(utilization(a)??-1)||a.name.localeCompare(b.name)
  }):[]
  return {
    overview:{summary:sessions,activity,partial:!snapshot.sessions.complete},
    operations:{attention:attention?.length??null,failed:attention?.filter(j=>j.lastResult==='Failed').length??null,warning:attention?.filter(j=>j.lastResult==='Warning').length??null,active:jobs?.filter(isRunning).length??null,partial:!snapshot.jobs.complete},
    capacity:{atRisk:repositories?.filter(r=>risks.includes(repositoryRisk(r))).length??null,total:repositories?.length??null,summary:repositories?capacitySummary(repositories):null,rows:ranked.slice(0,3).map(r=>({id:r.id,name:r.name,used:utilization(r),risk:repositoryRisk(r)})),partial:!snapshot.repositories.complete},
  }
}
