// Open Backup UI v1.0.2
import type {AdEntry} from './ad-client'

export const adCartLimit=256
export const directoryTransportMessage='Use HTTPS or open Open Backup UI on localhost to compare with production.'
export function canSendDirectoryCredentials(origin:string){
  try{
    const url=new URL(origin)
    return url.protocol==='https:'||url.protocol==='http:'&&(url.hostname==='localhost'||url.hostname==='[::1]'||/^127(?:\.\d{1,3}){3}$/.test(url.hostname))
  }catch{return false}
}
const key=(sourceKey:string,sessionId:string)=>'open-backup-ui.ad-cart.'+sourceKey+'.'+sessionId
export function selectableDirectoryItem(item:AdEntry){return (item.type==='item'||item.type==='container')&&Number.isInteger(item.dnt)&&item.dnt!>0&&item.dnt!<=2147483647}
export function mergeDirectoryItems(existing:AdEntry[],additional:AdEntry[]){
  const result=new Map<number,AdEntry>()
  for(const item of [...existing,...additional]){
    if(selectableDirectoryItem(item)&&!result.has(item.dnt!))result.set(item.dnt!,item)
  }
  return [...result.values()]
}
export function readDirectoryCart(sourceKey:string,sessionId:string):AdEntry[]{
  try{
    const parsed:unknown=JSON.parse(sessionStorage.getItem(key(sourceKey,sessionId))||'[]')
    if(!Array.isArray(parsed))return []
    return mergeDirectoryItems([],parsed.filter(row=>row&&typeof row.id==='string'&&typeof row.name==='string')).slice(0,adCartLimit)
  }catch{return []}
}
export function saveDirectoryCart(sourceKey:string,sessionId:string,items:AdEntry[]){
  try{
    const storage=key(sourceKey,sessionId)
    if(!items.length)sessionStorage.removeItem(storage)
    else sessionStorage.setItem(storage,JSON.stringify(items.map(({id,dnt,name,type,itemType,containerType})=>({id,dnt,name,type,itemType,containerType}))))
  }catch{/* The current tab can continue to use its in-memory list. */}
}
export function clearDirectoryCart(sourceKey:string,sessionId:string){saveDirectoryCart(sourceKey,sessionId,[])}
