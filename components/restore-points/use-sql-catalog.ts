'use client'
// Open Backup UI v1.0.2
import { useEffect, useMemo, useState } from 'react'
import type { AdScope } from '@/lib/restore-points/ad-client'
import {browseSqlPage, type SqlBrowseView} from '@/lib/restore-points/sql-browse-client'
import type { SqlItem } from './sql-explorer'

type CatalogPage = {items: SqlItem[]; nextSkip?: number}
type CatalogResult = {items: SqlItem[]; complete: boolean; error?: string}
const empty: CatalogResult = {items: [], complete: false}

// Only this list's parent can issue its handles. Display identity stays stable when a handle is renewed.
export function sqlNodeId(item: SqlItem) {
  return JSON.stringify([item.type, item.serverName || item.sqlServerName?.machineName,
    item.instanceId || item.sqlServerName?.instanceName, item.id ?? item.name ?? item.vmName ?? item.primaryFile])
}

export function useSqlCatalog({sourceKey,sessionId}: AdScope, view: SqlBrowseView, parent: SqlItem | SqlItem[] | undefined, revision: number, enabled = true) {
  const [attempt, setAttempt] = useState(0)
  const parents = useMemo(() => Array.isArray(parent) ? parent : [parent], [parent])
  const query = JSON.stringify([sourceKey, sessionId, view, parents.map(row=>row?.key), revision, attempt])
  const [result, setResult] = useState<CatalogResult & {query: string}>()
  useEffect(() => {
    if (!enabled || (view !== 'servers' && parents.some(p=>!p?.key))) return
    const controller = new AbortController()
    const entries = new Map<string, SqlItem>()
    async function read() {
      try {
        for (const p of parents) {
          let skip = 0
          for (;;) {
            const page = await browseSqlPage<CatalogPage>({sourceKey, sessionId, view, parent:p?.key, skip, limit:100},controller.signal)
            if (controller.signal.aborted) return
            for (const item of page.items) {
              const row = view==='databases' && p ? {...item,instanceId:item.instanceId||p.id,
                sqlServerName:{machineName:item.sqlServerName?.machineName||p.serverName,instanceName:item.sqlServerName?.instanceName??p.name}} : item
              entries.set(sqlNodeId(row),row)
            }
            const next=page.nextSkip
            if(next!=null && (!Number.isSafeInteger(next) || next<=skip || next>1000000))throw Error('VBR returned an invalid SQL browse page.')
            setResult({query,items:Array.from(entries.values()),complete:false})
            if(next==null)break
            skip=next
          }
        }
        if(!controller.signal.aborted)setResult({query,items:Array.from(entries.values()),complete:true})
      } catch (error) {
        if (!controller.signal.aborted) setResult({query, items: Array.from(entries.values()), complete: false,
          error: error instanceof Error ? error.message : String(error)})
      }
    }
    void read()
    return () => controller.abort()
  }, [enabled, sourceKey, sessionId, view, parents, query])
  const current = enabled && result?.query === query ? result : empty
  return {...current, retry: () => setAttempt(n => n + 1)}
}
