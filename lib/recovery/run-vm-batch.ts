// Open Backup UI v1.0.2
import type {RestoreBatches,BatchScope} from '../server/restore-batches'
import type {RecoverySend} from '../server/vbr-recovery'
import {saveEntireRestore} from '../server/entire-restore-records'
import {VbrRecoveryError} from './error'
import {checkPointOperation,submitPreparedRestore} from './start'
import {findPoint} from './options'
import {collide,prepareBatchRow} from './vm-batch'

const errorMessage=(err:unknown)=>err instanceof VbrRecoveryError?err.message.slice(0,1000):'VBR could not verify this recovery request.'
export async function runVmBatch(store:RestoreBatches,scope:BatchScope,id:string,runner:string,send:RecoverySend,save=saveEntireRestore) {
  // The VBR POST can hold the HTTP response during VM placement. Renew only
  // this worker's reservation while waiting. A stopped process loses the lease.
  const timer=setInterval(()=>{void store.update(scope,id,runner,()=>{}).catch(()=>{})},45_000)
  timer.unref()
  try{await execute(store,scope,id,runner,send,save)}finally{clearInterval(timer)}
}
async function execute(store:RestoreBatches,scope:BatchScope,id:string,runner:string,send:RecoverySend,save:typeof saveEntireRestore) {
  const update=<T,>(fn:Parameters<typeof store.update<T>>[3])=>store.update(scope,id,runner,fn)
  const rows=await update(r=>r.rows)
  const ready=new Map<number,Awaited<ReturnType<typeof prepareBatchRow>>>(),errors=new Map<number,string>()
  for(const [i,row] of rows.entries()){
    if(row.item.status!=='queued')continue
    try{
      await update(()=>{})
      const planned=await prepareBatchRow(send,scope.sourceKey,{objectId:row.item.objectId,draft:row.draft})
      ready.set(i,planned)
      await update(r=>{const out=r.rows[i];out.identity=planned.identity;Object.assign(out.item,planned.placement,{name:planned.name,targetName:planned.targetName})})
    }catch(err){errors.set(i,errorMessage(err))}
  }
  for(const [i,plan] of ready){
    for(const [j,row] of rows.entries()){
      if(i===j)continue
      const other=ready.get(j)?.identity??(['accepted','submitting','unknown'].includes(row.item.status)?row.identity:undefined)
      const message=other&&collide(plan.identity,other)
      if(message){errors.set(i,message);if(ready.has(j))errors.set(j,message)}
    }
  }
  if(errors.size){
    await update(r=>{for(const [i,{item}] of r.rows.entries())if(item.status==='queued'){
      item.status=errors.has(i)?'failed':'notStarted'
      item.message=errors.get(i)||'Another VM failed validation. This VM was not submitted.'
    }delete r.runner})
    return
  }
  for(const [i,plan] of ready){
    const {draft}=rows[i]
    try {checkPointOperation(await findPoint(send,draft.restorePointId,draft.backupId),draft)}
    catch(err){await update(r=>{r.rows[i].item.status='failed';r.rows[i].item.message=errorMessage(err)});continue}
    // Persist ownership before the irreversible POST. A crash between these lines
    // is conservatively unknown; a resume only ever processes never-started rows.
    await update(r=>{r.rows[i].item.status='submitting'})
    let result:Awaited<ReturnType<typeof submitPreparedRestore>>
    try{
      result=await submitPreparedRestore(send,scope.sourceKey,plan.prepared,save)
    }catch(err){
      const failed=err instanceof VbrRecoveryError && !err.uncertain && err.status>=400 && err.status<500 && err.status!==408
      await update(r=>{const item=r.rows[i].item;item.status=failed?'failed':'unknown';item.message=failed?errorMessage(err):'VBR submission could not be confirmed. Check Sessions before starting another recovery.'})
      continue
    }
    // A storage error after native acceptance is never a VBR rejection.
    await update(r=>{const item=r.rows[i].item;item.status='accepted';item.sessionId=result.id;item.sessionType=result.sessionType})
  }
  await update(r=>{delete r.runner})
}
