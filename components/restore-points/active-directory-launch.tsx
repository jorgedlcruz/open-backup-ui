'use client'
// Open Backup UI v1.0.2

import { useRef, useState } from 'react'
import { ArrowLeft, Database, FolderTree } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isFlagged, type RestorePoint } from '@/lib/restore-points/model'
import { activeDirectoryOperation, sqlOperation, beginExplorerLaunch, type RestoreLaunch } from '@/lib/restore-points/launch'
import { useRecoveryPresentation } from './use-presentation'
import styles from './workflow.module.css'

export type ExplorerLaunchProps = {
  point:RestorePoint; sourceKey:string; backupObjectId:string; onBack:()=>void; onLaunch:(receipt:RestoreLaunch)=>void
}
export function ApplicationExplorerLaunch({point, sourceKey, backupObjectId, onBack, onLaunch, sql}:ExplorerLaunchProps&{sql?:boolean}) {
  const {t, date, label} = useRecoveryPresentation()
  const submitting = useRef(false)
  const [reviewed, setReviewed] = useState<string>()
  const needsReview = isFlagged(point.malwareStatus) && reviewed !== point.malwareStatus
  const Icon=sql?Database:FolderTree
  function start() {
    if (submitting.current || needsReview) return
    submitting.current = true
    const operation=sql?sqlOperation:activeDirectoryOperation
    onLaunch(beginExplorerLaunch({sourceKey,operation,restorePointId:point.id,backupId:point.backupId,backupObjectId,
      reviewedMalwareStatus:point.malwareStatus||undefined},point.name||t(sql?'Microsoft SQL Server':'Microsoft Active Directory'),point.creationTime||undefined))
  }
  return <section className={styles.flow}>
    <p>{sql?t('Browse SQL instances and databases at this restore point.'):t('Open this restore point to browse its directory objects. Choose what to recover in the session.')}</p>
    <dl className={styles.summary}>
      {point.name && <div><dt>{t('Protected workload')}</dt><dd>{point.name}</dd></div>}
      <div><dt>{t('Selected restore point')}</dt><dd>{date(point.creationTime)}</dd></div>
      <div><dt>{t('Point malware status')}</dt><dd>{point.malwareStatus ? label(point.malwareStatus) : t('Unknown')}</dd></div>
    </dl>
    {isFlagged(point.malwareStatus) && <label className={styles.check}><input type="checkbox" checked={!needsReview}
      onChange={event=>setReviewed(event.target.checked ? point.malwareStatus || undefined : undefined)}/>{t('I have reviewed the reported malware status.')}</label>}
    <div className={styles.actions}>
      <Button type="button" variant="outline" onClick={onBack}><ArrowLeft size={15}/>{t('Back')}</Button>
      <Button type="button" disabled={needsReview} onClick={start}><Icon size={15}/>{sql?t('Browse SQL databases'):t('Browse Active Directory')}</Button>
    </div>
  </section>
}
