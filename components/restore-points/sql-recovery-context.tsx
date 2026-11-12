'use client'
// Open Backup UI v1.2.0
import {Clock3} from 'lucide-react'
import {useRecoveryPresentation} from './use-presentation'
import type {SqlItem} from './sql-explorer'
import styles from './sql-recovery-context.module.css'

export function SqlRecoveryContext({items}:{items:SqlItem[]}) {
  const {t,date}=useRecoveryPresentation()
  if(!items.length)return null
  const spans=items.map(item=>{
    const range=item.timeRange
    const from=Date.parse(range?.from||range?.startTime||''),to=Date.parse(range?.to||range?.endTime||'')
    if(Number.isFinite(from)&&Number.isFinite(to)&&from<=to)return [from,to]
    const backup=Date.parse(item.backupCreated||item.guestBackupEndTime||'')
    return Number.isFinite(backup)?[backup,backup]:undefined
  })
  if(spans.some(span=>!span))return null
  const from=Math.max(...spans.map(span=>span![0])),to=Math.min(...spans.map(span=>span![1]))
  const interval=to-from>60000
  return <div className={styles.context} aria-label={t('SQL recovery context')}>
    <span className={styles.label}><Clock3 size={14}/>{interval?t('Recovery window'):from>to?t('Recovery window'):t('Backup time')}</span>
    {from>to?<span>{t('No shared recovery time')}</span>:interval?<span className={styles.times}>
      <time dateTime={new Date(from).toISOString()}>{date(from)}</time><i aria-hidden/><time dateTime={new Date(to).toISOString()}>{date(to)}</time>
    </span>:<time dateTime={new Date(to).toISOString()}>{date(to)}</time>}
  </div>
}
