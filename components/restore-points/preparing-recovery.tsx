'use client'
// Open Backup UI v1.0.2

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeft, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { activeDirectoryOperation, sqlOperation, isStorageOperation, canCheckExplorerLaunch, observeAddressedLaunch, readRestoreLaunch, type RestoreLaunch } from '@/lib/restore-points/launch'
import { recoveryCenterPath, sessionsPath, sessionHomeFor, sessionHref, type SessionHome } from '@/lib/navigation/recovery'
import { useRecoveryPresentation } from './use-presentation'
import { RecoverySignal } from './recovery-signal'
import ops from '@/components/operations/operations.module.css'
import styles from './workflow.module.css'

export function PreparingRecovery({ requestId,sourceKey,provider }: { requestId: string;sourceKey?:string;provider?:string }) {
  const router = useRouter()
  const home = sessionHomeFor(usePathname())
  const [receipt, setReceipt] = useState<RestoreLaunch>()
  const [loaded, setLoaded] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    const read = () => { const row=readRestoreLaunch(requestId);setReceipt(!sourceKey||row?.sourceKey===sourceKey?row:undefined) }
    read()
    setLoaded(true)
    window.addEventListener('restore-launch-change', read)
    void observeAddressedLaunch(requestId,sourceKey,provider).then(value => {
      if (!active) return
      setReceipt(value)
      if (value?.phase === 'accepted' && value.sessionId) router.replace(sessionHref(home, value.sessionId, value.sourceKey) +
        (value.operation === activeDirectoryOperation || value.operation === sqlOperation ? '#application-items' : value.operation==='StartFlrRestore' ? '#guest-files' : ['nas-files','object-files','nas-instant'].includes(value.operation) ? '#unstructured-data' : '#session-log'))
    })
    return () => { active = false; window.removeEventListener('restore-launch-change', read) }
  }, [requestId, sourceKey, provider, router, home, revision])

  return <RecoveryHandoff receipt={receipt} loading={!loaded} home={home} onCheck={() => setRevision(value => value + 1)}/>
}

export function RecoveryHandoff({receipt, loading = false, home = recoveryCenterPath, onCheck}: {
  receipt?: RestoreLaunch; loading?: boolean; home?: SessionHome; onCheck?: () => void
}) {
  const { t, date, label, diagnostic } = useRecoveryPresentation()
  const accepted = receipt?.phase === 'accepted'
  const pending = loading || receipt?.phase === 'starting' || accepted
  const explorer = receipt?.operation === activeDirectoryOperation || receipt?.operation === sqlOperation
  const browseUnconfirmed = explorer && receipt.phase === 'unknown'
  const message = receipt?.message?.trim()
  const showDiagnostic = message && !/^(?:typeerror:\s*)?(?:failed to fetch|fetch failed|load failed|networkerror when attempting to fetch resource)\.?$/i.test(message)
  const sessions = browseUnconfirmed && receipt.workload ? home + '?' + new URLSearchParams({name:receipt.workload}) : home
  return <div className={ops.console}>
    <Link href={home} className={styles.returnLink}><ArrowLeft size={15} />{home === recoveryCenterPath ? t('Recovery Center') : t('Sessions')}</Link>
    <header className={ops.header}><div><h1>{receipt ? label(receipt.operation) : t('Recovery request')}</h1>
      {receipt && <p>{receipt.workload}{receipt.pointTime && <> · {t('Selected restore point')}{' '}
        <time dateTime={receipt.pointTime}>{date(receipt.pointTime)}</time></>}</p>}</div></header>
    <section className={ops.panel}>
      <div className={styles.launchStatus} role={pending ? undefined : 'alert'}>
        {!pending && <TriangleAlert aria-hidden size={23} />}
        <div><h2>{pending ? t('Preparing recovery') : receipt?.phase === 'rejected' ? t('Recovery request failed.') : browseUnconfirmed ? t('Browse session unconfirmed') : t('Recovery status unconfirmed')}</h2>
          {pending && <RecoverySignal stage={accepted ? 'accepted' : receipt ? 'request' : 'data'}
            status={explorer && !accepted ? t(receipt.explorerStage === 'checking' ? 'Checking with VBR' : 'Waiting for Explorer') : undefined}/>}
          {!pending && <p>{receipt?.phase === 'rejected' ? diagnostic(receipt.message || t('Recovery request failed.')) : browseUnconfirmed
            ? (home===recoveryCenterPath?t('Check Recovery Center before submitting another request.'):t('VBR has not confirmed a browse session for this request. Check the sessions for this workload before opening another.'))
            : home === recoveryCenterPath ? t('Check Recovery Center before submitting another request.') : t('Check Sessions before submitting another request.')}</p>}
          {!pending && receipt?.phase === 'unknown' && showDiagnostic && <p>{diagnostic(message)}</p>}
          {!pending && <div className={styles.handoffActions}>
            {onCheck && (canCheckExplorerLaunch(receipt)||receipt?.phase==='unknown'&&isStorageOperation(receipt.operation)) && <Button type="button" size="sm" onClick={onCheck}>{t('Check status')}</Button>}
            <Button asChild variant="outline" size="sm"><Link href={sessions}>{home === sessionsPath ? t('View sessions') : t('Recovery Center')}</Link></Button>
          </div>}
        </div>
      </div>
    </section>
  </div>
}
