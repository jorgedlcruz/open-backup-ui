'use client'
// Open Backup UI v1.2.0

import {Fragment, useEffect, useState} from 'react'
import {useI18n} from '@/components/providers/i18n-provider'
import {ApplicationRequestError} from '@/lib/api/application-request'
import {veeamApi} from '@/lib/api/veeam-client'
import {migrationHops, readMigrationPlan, readMigrationProxies, type MigrationProxies, type MigrationSpeed} from '@/lib/activity/migration-plan'
import type {TaskInvestigation} from '@/lib/investigation/model'
import {RecoveryConnector, RecoveryNode, type RecoveryPhase} from './recovery-diagram'

// Read exactly the selected VM task. VBR can choose its proxies after writing the plan.
export function useMigrationTask(sourceKey:string, sessionId?:string, taskId?:string, working?:boolean) {
  const [state,setState] = useState<{key:string; data?:TaskInvestigation; error?:string}>()
  const key = [sourceKey,sessionId,taskId].join('/')
  useEffect(() => {
    if (!sessionId || !taskId) return
    const controller = new AbortController(), sid=sessionId, tid=taskId
    let timer:ReturnType<typeof setTimeout>, running=false, finished=false
    async function read() {
      if (controller.signal.aborted || document.hidden || running || finished) return
      running=true
      try {
        const data=await veeamApi.getTaskInvestigation(sid,tid,controller.signal,sourceKey)
        if (controller.signal.aborted) return
        if (data.task.id !== tid || data.task.sessionId !== sid) throw new Error('Request failed.')
        setState({key,data})
        finished=!working || !!data.task.endTime || data.task.state === 'Stopped'
      } catch (error) {
        if (controller.signal.aborted) return
        setState({key,error:error instanceof Error ? error.message : 'Request failed.'})
        finished=!working || error instanceof ApplicationRequestError && [400,401,403,404,409].includes(error.status)
      } finally {running=false}
      if (!finished && !controller.signal.aborted) timer=setTimeout(read,15000)
    }
    void read()
    function visible() {if (!document.hidden) {clearTimeout(timer); void read()}}
    document.addEventListener('visibilitychange',visible)
    return () => {controller.abort();clearTimeout(timer);document.removeEventListener('visibilitychange',visible)}
  },[sourceKey,sessionId,taskId,key,working])
  const verified=state?.key===key ? state : undefined
  const rows=verified?.data?.logs.available ? verified.data.logs.data : []
  return {plan:readMigrationPlan(rows), proxies:verified?.data?.logs.complete ? readMigrationProxies(rows) : {},
    task:verified?.data?.task,error:verified?.error}
}

export function MigrationPath({proxies,phase,speed}:{proxies:MigrationProxies;phase?:RecoveryPhase;speed?:MigrationSpeed}) {
  const {t,formatNumber}=useI18n(), hops=migrationHops(proxies)
  const rate=phase==='active' && speed ? speed.bytesPerSecond : undefined
  const divisor=rate===undefined || rate<1000 ? 1 : rate<1e6 ? 1e3 : rate<1e9 ? 1e6 : 1e9
  const metric=rate===undefined ? undefined : {
    label:speed?.basis==='transferred' ? t('Transfer speed') : t('Processing rate'),
    value:formatNumber(rate/divisor,{maximumFractionDigits:2})+' '+({1:'B/s',1000:'KB/s',1000000:'MB/s',1000000000:'GB/s'}[divisor]),
  }
  const read=!!proxies.source, write=!!proxies.target
  return <>
    {hops.map((hop,index)=>{
      const role=hop.role==='both' ? t('Source and target proxy') : hop.role==='source' ? t('Source proxy') : t('Target proxy')
      const different=hop.role==='both' && hop.read!==hop.write
      const mode=hop.read || hop.write
      const facts=different ? [
        ...(hop.read ? [{label:t('Read'),value:hop.read}] : []), ...(hop.write ? [{label:t('Write'),value:hop.write}] : []),
      ] : mode ? [{label:t('Transport mode'),value:mode}] : []
      return <Fragment key={hop.role}>
        <RecoveryConnector phase={phase} io={index===0 && read ? 'read' : undefined} label={index===0 && read ? t('Read') : undefined}
          measurement={hops.length===2 && index===1 ? metric : undefined}/>
        <RecoveryNode kind="proxy" label={role} name={hop.name} facts={facts}/>
      </Fragment>
    })}
    <RecoveryConnector phase={phase} io={write ? 'write' : undefined} label={write ? t('Write') : undefined}
      measurement={hops.length===2 ? undefined : metric}/>
  </>
}
