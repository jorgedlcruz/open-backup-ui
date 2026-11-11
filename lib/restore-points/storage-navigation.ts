// Open Backup UI v1.2.0
import {storageEntry,type StorageItem} from './unstructured-workspace'

export type StorageCrumb={path:string;label:string}
export type StorageFolder={path:string;name:string;drive:boolean}

/** VBR's NAS browser can drop a leading pipe between levels. This key is only for
 * matching UI nodes; every browse/restore request retains its original native path. */
export const storagePathKey=(path:string,separator:string)=>separator==='|'?path.replace(/^\|+/,''):path
export const sameStoragePath=(a:string,b:string,separator:string)=>storagePathKey(a,separator)===storagePathKey(b,separator)

/** Paths remain case-sensitive and Windows/UNC roots retain their exact meaning. */
export function pathWithin(path:string,parent:string,separator:string){
  path=storagePathKey(path,separator);parent=storagePathKey(parent,separator)
  return !parent||path===parent||!!separator&&path.startsWith(parent)&&
    (parent.endsWith(separator)||path.slice(parent.length).startsWith(separator))
}

export function storageFolders(items:StorageItem[],parent:string,separator:string):StorageFolder[]{
  const folders=new Map<string,StorageFolder>()
  for(const item of items){
    if(item.type!=='Folder'&&item.type!=='Drive')continue
    const entry=storageEntry(item,parent,separator)
    if(!entry||sameStoragePath(entry.path,parent,separator)||!pathWithin(entry.path,parent,separator))continue
    const key=storagePathKey(entry.path,separator)
    if(!folders.has(key))folders.set(key,{path:entry.path,name:item.name,drive:item.type==='Drive'})
  }
  return [...folders.values()]
}

/** Keep native roots intact: a root may itself contain several apparent path segments. */
export function storageCrumbs(path:string,separator:string,roots:readonly StorageCrumb[]=[]):StorageCrumb[]{
  if(!path)return []
  if(!separator)return [{path,label:path}]
  const anchor=roots.filter(root=>root.path&&pathWithin(path,root.path,separator)).sort((a,b)=>storagePathKey(b.path,separator).length-storagePathKey(a.path,separator).length)[0]
  const crumbs:StorageCrumb[]=anchor?[anchor]:[]
  let cursor=anchor?path.length-storagePathKey(path,separator).length+storagePathKey(anchor.path,separator).length:0
  if(!anchor&&separator==='\\'&&path.startsWith('\\\\')){
    const serverEnd=path.indexOf(separator,2)
    const shareEnd=serverEnd<0?-1:path.indexOf(separator,serverEnd+1)
    const rootEnd=shareEnd<0?path.length:shareEnd
    crumbs.push({path:path.slice(0,rootEnd),label:path.slice(0,rootEnd)})
    cursor=rootEnd
  }
  while(cursor<path.length){
    if(path.startsWith(separator,cursor)){cursor+=separator.length;continue}
    const next=path.indexOf(separator,cursor),end=next<0?path.length:next
    const label=path.slice(cursor,end)
    const drive=cursor===0&&separator==='\\'&&/^[A-Za-z]:$/.test(label)&&next>=0
    crumbs.push({path:path.slice(0,end+(drive?separator.length:0)),label})
    cursor=end
  }
  return crumbs.length?crumbs:[{path,label:path}]
}
