// Open Backup UI v1.3.0
import { createHash, randomUUID } from 'crypto'
import { RecoveryError, type RecoveryContext, type RecoveryPage, type RequestReceipt } from './model'

type Entry={fingerprint:string;receipt:RequestReceipt;promise:Promise<unknown>;updatedAt:number}
type SessionEntry={context?:RecoveryContext;parentSessionId?:string;updatedAt:number}
type Store={requests:Map<string,Entry>;sessions:Map<string,SessionEntry>}
const globalStore=globalThis as typeof globalThis & {__vbmRecoveryStore?:Store}
const store=globalStore.__vbmRecoveryStore ||= {requests:new Map(),sessions:new Map()}
const key=(scope:string,id:string)=>JSON.stringify([scope,id])
const retention=24*60*60*1000
type BrowseCache = {id:string;sourceSession?:string;pages:Map<string,RecoveryPage>;closed:boolean;updatedAt:number}
const processCache=globalThis as typeof globalThis & {__vbmBrowsePages?:Map<string,BrowseCache>}
const browseCaches=processCache.__vbmBrowsePages ||= new Map<string,BrowseCache>()

// A bucket belongs to the authenticated source scope, including after a route module reload.
// Open restore points keep all visited pages until the source reports the session closed.
export function sessionBrowseCache(scope:string,id:string,sourceOrigin?:string):BrowseCache {
  const identity=key(scope,id.toLowerCase())
  let cache=browseCaches.get(identity)
  if(!cache) {
    cache={id:randomUUID(),pages:new Map(),closed:false,updatedAt:Date.now()}
    browseCaches.set(identity,cache)
  }
  if(sourceOrigin)cache.sourceSession=key(sourceOrigin,id.toLowerCase())
  if(!cache.closed)cache.updatedAt=Date.now()
  return cache
}

function closeCache(cache:BrowseCache) {
  if(!cache.closed) {
    cache.closed=true
    cache.pages.clear()
    cache.updatedAt=Date.now()
  }
}

export function observeBrowseSession(scope:string,id:string,state:string,sourceOrigin?:string) {
  const normalizedId=id.toLowerCase()
  const cache=browseCaches.get(key(scope,normalizedId))
  if(state!=='Stopped') {
    if(cache&&!cache.closed)cache.updatedAt=Date.now()
    return
  }
  if(cache)closeCache(cache)
  // Only a confirmed session stop is shared across operators of this Veeam endpoint.
  if(sourceOrigin) {
    const identity=key(sourceOrigin,normalizedId)
    for(const other of browseCaches.values())if(other.sourceSession===identity)closeCache(other)
  }
}

export function forgetBrowseSession(scope:string,id:string) {
  const identity=key(scope,id.toLowerCase()),cache=browseCaches.get(identity)
  if(cache)closeCache(cache)
  browseCaches.delete(identity)
}

function prune() {
  const cutoff=Date.now()-retention
  for(const [id,cache] of browseCaches)if(!cache.pages.size && cache.updatedAt<cutoff) {
    closeCache(cache)
    browseCaches.delete(id)
  }
  for(const [id,value] of store.requests)if(value.updatedAt<cutoff && value.receipt.status!=='pending')store.requests.delete(id)
  for(const [id,value] of store.sessions)if(value.updatedAt<cutoff)store.sessions.delete(id)
  while(store.sessions.size>2000)store.sessions.delete(store.sessions.keys().next().value!)
}
export function rememberSession(scope:string,id:string,value:Omit<SessionEntry,'updatedAt'>) {prune();store.sessions.set(key(scope,id),{...value,updatedAt:Date.now()})}
export function sessionContext(scope:string,id:string){prune();const value=store.sessions.get(key(scope,id));return value ? {context:value.context,parentSessionId:value.parentSessionId}:undefined}
export function requestReceipt(scope:string,id:string):RequestReceipt {prune();const entry=store.requests.get(key(scope,id));if(!entry)throw new RecoveryError('This request receipt is unavailable. Check restore sessions before starting another request.',404,true);return entry.receipt}

/** The fingerprint contains no plaintext credentials; receipts contain only normalized results. */
export function beginOnce<T>(scope:string,id:string,input:unknown,run:(waitingForProxy:(waiting:boolean)=>void)=>Promise<T>):Promise<T> {
  prune()
  const requestKey=key(scope,id),fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex'),existing=store.requests.get(requestKey)
  if(existing) {
    if(existing.fingerprint!==fingerprint)throw new RecoveryError('This request ID was already used for different recovery options.',409)
    return existing.promise as Promise<T>
  }
  if(store.requests.size>=1000)throw new RecoveryError('Too many recovery request receipts are retained. Try again later.',503)
  const entry:Entry={fingerprint,receipt:{status:'pending',createdAt:new Date().toISOString()},updatedAt:Date.now(),promise:Promise.resolve()}
  store.requests.set(requestKey,entry)
  const setWaiting = (waiting:boolean) => {
    if (waiting) entry.receipt.phase='waitingForProxy'
    else delete entry.receipt.phase
  }
  entry.promise=Promise.resolve().then(()=>run(setWaiting)).then(result=>{entry.receipt={createdAt:entry.receipt.createdAt,status:'completed',result};entry.updatedAt=Date.now();return result},error=>{entry.receipt={createdAt:entry.receipt.createdAt,status:error instanceof RecoveryError && error.outcomeUnknown ? 'unknown':'failed',error:error instanceof RecoveryError ? error.message:'The recovery request could not be completed.'};entry.updatedAt=Date.now();throw error})
  return entry.promise as Promise<T>
}

export async function once<T>(scope:string,id:string,input:unknown,run:()=>Promise<T>):Promise<T> {
  return beginOnce(scope,id,input,run)
}
