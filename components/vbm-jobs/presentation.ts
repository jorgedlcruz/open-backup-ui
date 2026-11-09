'use client'
// Open Backup UI v1.0.2

import { useDashboardPresentation } from '@/components/vbm-dashboard/presentation'
import { m365Diagnostic, m365Label } from '@/lib/i18n/m365'
import type { Session, Window } from '@/lib/vbm-jobs/model'
import { time } from '@/lib/investigation/model'

export function useVbmPresentation() {
  const base=useDashboardPresentation(),{t,formatNumber,locale}=base
  return {...base, localLabel:(source:string)=>m365Label(t,source,locale), localValue:base.value,
    localLookup:(rows:{id:string;name?:string|null}[],id?:string|null)=>rows.find(row=>row.id.toLowerCase()===id?.toLowerCase())?.name || id || t('Not reported'),
    localCount:(evidence:{available:boolean;complete:boolean;data?:unknown[];count?:number|null},count=evidence.data?.length ?? evidence.count ?? 0)=>evidence.available ? `${formatNumber(count)}${evidence.complete?'':'+'}`:t('Unknown'),
    localDuration:(session:Session)=>{const start=time(session.creationTime),end=time(session.endTime);if(start===null||end===null||end<start)return session.status==='Running'?t('In progress'):t('Not reported');const seconds=Math.floor((end-start)/1000);return seconds>=3600?t('{hours}h {minutes}m {seconds}s',{hours:formatNumber(Math.floor(seconds/3600)),minutes:formatNumber(Math.floor(seconds%3600/60)),seconds:formatNumber(seconds%60)}):t('{minutes}m {seconds}s',{minutes:formatNumber(Math.floor(seconds/60)),seconds:formatNumber(seconds%60)})},
    localWindow:(window:Window)=>window==='all'?t('All retained history'):t('Last {days} days',{days:formatNumber(Number(window))}),
    diagnostic:(source:string)=>m365Diagnostic(t,source,locale),
  }
}
