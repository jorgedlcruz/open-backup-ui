// Open Backup UI v1.2.0
import {sqlRequest, type AdScope} from './ad-client'

export type SqlBrowseView = 'servers' | 'instances' | 'databases' | 'files'
type BrowseInput = AdScope & {view:SqlBrowseView; parent?:string; skip:number; limit:number}
const queues = new Map<string, Promise<void>>()

// A native SQL Explorer browse session has one active search. A UI change detaches
// the caller, while an already-started VBR search gets polled to completion.
export function browseSqlPage<T>(input:BrowseInput, signal?:AbortSignal):Promise<T> {
  const key = JSON.stringify([input.sourceKey,input.sessionId])
  const response = (queues.get(key) || Promise.resolve()).then(async () => {
    signal?.throwIfAborted()
    const page = await sqlRequest<T>({...input, action:'browse'})
    signal?.throwIfAborted()
    return page
  })
  const settled = response.then(()=>{},()=>{})
  queues.set(key,settled)
  void settled.then(()=>{if(queues.get(key)===settled)queues.delete(key)})
  return response
}
