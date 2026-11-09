// Open Backup UI v1.0.2
import { veeamApi } from '../api/veeam-client'

export type AdEntry = {
  id:string; name:string; type:'domain'|'container'|'item'|'attribute'; dnt?:number; containerType?:string
  dnsZoneCategory?:string; itemType?:string; description?:string; values?:string[]
}
export type AdPage = {items:AdEntry[]; total:number}
export type AdScope = {sessionId:string; sourceKey:string}
export type AdWorkflow = {id:string; key:string; intent:'restore'|'export'}

function waitForPoll(signal?: AbortSignal) {
  signal?.throwIfAborted()
  return new Promise<void>((resolve,reject) => {
    const abort = () => {clearTimeout(timer); reject(signal?.reason)}
    const timer = setTimeout(() => {signal?.removeEventListener('abort',abort); resolve()},1000)
    signal?.addEventListener('abort',abort,{once:true})
  })
}

type Command={action:string;sourceKey:string;[key:string]:unknown}
export function adRequest<T>(input:Command,signal?:AbortSignal) { return explorerRequest<T>('ad',input,signal) }
export function sqlRequest<T>(input:Command,signal?:AbortSignal) { return explorerRequest<T>('sql-explorer',input,signal) }
async function explorerRequest<T>(provider:'ad'|'sql-explorer', input:Command, signal?: AbortSignal): Promise<T> {
  let command = input
  for (;;) {
    const result = await veeamApi.applicationExplorerRequest<T | {pending:string}>(provider,command,signal)
    if (!result || typeof result !== 'object' || !('pending' in result) || typeof result.pending !== 'string') return result as T
    await waitForPoll(signal)
    command = {action:'poll', sourceKey:input.sourceKey, ...(provider==='ad'&&input.sessionId ? {sessionId:input.sessionId} : {}), pending:result.pending}
  }
}

export function adParent(entry?: AdEntry) {
  if (entry?.dnt == null || entry.type === 'domain') return undefined
  return {dnt:entry.dnt, containerType:entry.containerType, dnsZoneCategory:entry.dnsZoneCategory}
}
