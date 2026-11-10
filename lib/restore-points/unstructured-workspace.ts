// Open Backup UI v1.2.0
export type StorageView='browse'|'instant'
export type StorageScope={sourceKey:string;sessionId:string;view:StorageView}
export type StorageStatus=StorageScope & {actions:string[];name?:string;state?:string;pathSeparator?:string}
export type StorageAction='copy'|'restore'|'finish'|'migrate'|'switchover'
export type StorageItem={name:string;type:string;location?:string|null;size?:number|null;versionsCount?:number|null;modifiedDate?:string|null}
export type StorageEntry={path:string;type:string;version?:string}
export type StorageTask={taskId:string;taskKey:string}
export type StorageTransfer=StorageTask & {action:'copy'|'restore'}
export function storageView(type?:string,receipt?:string):StorageView|undefined {
  if(type==='UnstructuredDataBrowse')return 'browse'
  if(type==='FileInstantRecovery')return 'instant'
  if(type)return
  if(receipt==='nas-files'||receipt==='object-files')return 'browse'
  if(receipt==='nas-instant')return 'instant'
}
export function storageEntry(item:StorageItem,parent:string,separator:string,search=false):StorageEntry|undefined {
  if(!item.name||!['File','Folder','Drive','Link'].includes(item.type))return
  if(search&&item.location==null&&item.type!=='Drive')return
  const base=item.location??parent
  const path=item.type==='Drive' ? item.name+(/^[a-z]:$/i.test(item.name)?separator:'') :
    base ? base+(base.endsWith(separator)?'':separator)+item.name : item.name
  return {type:item.type,path}
}
export const itemIdentity=(row:StorageEntry)=>JSON.stringify([row.path,row.version||''])
export const isFolder=(row:StorageEntry)=>row.type==='Folder'||row.type==='Drive'
export function storageSelectionValid(items:StorageEntry[]){
  return !!items.length&&items.length<=200&&items.every(r=>r.path.trim()&&!['/','\\'].includes(r.path))&&
    (!items.some(r=>r.version)||items.length===1)
}
const workspaceKey=(scope:StorageScope,part:string)=>'open-backup-ui.storage-'+part+'.'+scope.sourceKey+'.'+scope.sessionId+'.'+scope.view
export function readStorageValue<T>(scope:StorageScope,part:string):T|undefined {
  try {return JSON.parse(sessionStorage.getItem(workspaceKey(scope,part))||'null')??undefined}catch{return}
}
export function writeStorageValue(scope:StorageScope,part:string,value?:unknown){
  try{if(value===undefined)sessionStorage.removeItem(workspaceKey(scope,part));else sessionStorage.setItem(workspaceKey(scope,part),JSON.stringify(value))}catch{}
}
export function readStorageCart(scope:StorageScope):StorageEntry[]{
  const rows=readStorageValue<unknown>(scope,'cart')
  if(!Array.isArray(rows))return []
  return rows.filter(row=>row&&typeof row.path==='string'&&typeof row.type==='string'&&(!row.version||typeof row.version==='string')).slice(0,200)
}
export function mergeStorageCart(existing:StorageEntry[],more:StorageEntry[]){
  return [...new Map([...existing,...more].map(row=>[itemIdentity(row),row])).values()]
}
export function finishedStorageTask(task:{state:string;result?:string|null}){
  if(task.result==='Failed'||task.result==='Canceled'||task.result==='Cancelled')return 'failed'
  if(task.state==='Stopped'||task.state==='Finished'||task.state==='Completed'){
    if(task.result==='Success'||task.result==='Warning')return 'ready'
    return 'failed'
  }
  return 'working'
}
