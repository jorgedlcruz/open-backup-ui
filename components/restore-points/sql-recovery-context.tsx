'use client'
// Open Backup UI v1.0.2
import {Clock3,Database,Layers3,Server} from 'lucide-react'
import {useRecoveryPresentation} from './use-presentation'
import type {SqlItem} from './sql-explorer'
import styles from './sql-recovery-context.module.css'

function rangeOf(item:SqlItem) {
  const r=item.timeRange,from=Date.parse(r?.from||r?.startTime||''),to=Date.parse(r?.to||r?.endTime||'')
  return Number.isFinite(from)&&Number.isFinite(to)&&from<=to ? [from,to] as const : undefined
}
export function SqlRecoveryContext({path,selected}:{path:SqlItem[];selected:SqlItem[]}) {
  const {t,date,formatNumber}=useRecoveryPresentation()
  if(path.length<2 && !selected.length) return null
  const shown=selected.length?selected:path.slice(-1)
  const spans=shown.map(rangeOf), known=spans.every((s):s is readonly [number,number]=>!!s)
  const from=known?Math.max(...spans.map(s=>s[0])):NaN,to=known?Math.min(...spans.map(s=>s[1])):NaN
  const interval=known&&from<to, one=known&&from===to
  const server=path[0]?.name||shown[0]?.sqlServerName?.machineName||path[0]?.vmName
  const instance=path[1]?.name||shown[0]?.sqlServerName?.instanceName
  return <aside className={styles.context} aria-label={t('SQL recovery context')}>
    <div className={styles.identity}><div aria-hidden className={styles.symbol}><Database size={23}/><Layers3 size={12}/></div>
      <div><small><Server size={12}/>{server}</small><strong>{instance||t('Microsoft SQL Server')}</strong></div>
    </div>
    <div className={styles.window}><small><Clock3 size={12}/>{interval?t('Recovery window'):one?t('Backup time'):t('Recovery window')}</small>
      {interval?<div className={styles.times}><time dateTime={new Date(from).toISOString()}>{date(from)}</time><i aria-hidden/><time dateTime={new Date(to).toISOString()}>{date(to)}</time></div>
        :one?<time dateTime={new Date(from).toISOString()}>{date(from)}</time>:<span>{known?t('No shared recovery time'):t('Not reported')}</span>}
    </div>
    {selected.length>0&&<div className={styles.selection}><small>{t('Selected')}</small><strong>{selected.length===1?selected[0].name:formatNumber(selected.length)}</strong></div>}
  </aside>
}
