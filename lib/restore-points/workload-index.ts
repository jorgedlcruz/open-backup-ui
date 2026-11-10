// Open Backup UI v1.0.2
import type {PickerPage,RecoveryObject} from './recovery-picker'

type Page=PickerPage<RecoveryObject>
type Reader=(args:Record<string,string>,signal:AbortSignal)=>Promise<Page>
type Progress=(page:Page,finished:boolean)=>void
const pageSize=200

// The server pins an ordered index for this source, principal and recovery scope.
// If the pin expires, discard its rows before revealing a replacement snapshot.
export async function readWorkloadIndex(read:Reader,signal:AbortSignal,refresh:boolean,onPage:Progress,onRestart:()=>void){
  let restarted=false
  while(!signal.aborted){
    let snapshotId:string|undefined,rows:RecoveryObject[]=[],total:number|undefined
    try{
      do{
        const page=await read({offset:String(rows.length),limit:String(pageSize),
          ...(snapshotId?{snapshotId}:refresh?{refresh:'true'}:{})},signal)
        if(signal.aborted)return
        if(!Number.isSafeInteger(page.total)||page.total<0||rows.length+page.data.length>page.total||
          (snapshotId!==undefined&&(snapshotId!==page.snapshotId||page.total!==total))||
          (rows.length+page.data.length<page.total&&(!page.data.length||!page.snapshotId)))throw Error('VBR returned an invalid selection list.')
        rows=rows.concat(page.data);total=page.total;snapshotId=page.snapshotId
        const finished=rows.length===total
        onPage({...page,data:rows},finished)
        if(finished)return
      }while(!signal.aborted)
    }catch(e){
      if(signal.aborted)return
      if(!snapshotId||restarted||!(e instanceof Error&&'status' in e&&e.status===409))throw e
      restarted=true;onRestart()
    }
  }
}
