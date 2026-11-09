'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CalendarCheck, Check, FileText, Loader2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { observeRestoreLaunch, readRestoreLaunch, type RestoreLaunch } from '@/lib/restore-points/launch'
import { restoreActivityUrl } from '@/lib/restore-points/workflow'
import { useRecoveryPresentation } from './use-presentation'
import ops from '@/components/operations/operations.module.css'
import styles from './workflow.module.css'

export function PreparingRecovery({ requestId }: { requestId: string }) {
  const router = useRouter()
  const [receipt, setReceipt] = useState<RestoreLaunch>()
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let active = true
    setReceipt(readRestoreLaunch(requestId))
    setLoaded(true)
    void observeRestoreLaunch(requestId).then(value => {
      if (!active) return
      setReceipt(value)
      if (value?.phase === 'accepted' && value.sessionId) router.replace(restoreActivityUrl(value.sessionId, value.sourceKey))
    })
    return () => { active = false }
  }, [requestId, router])

  return <RecoveryHandoff receipt={receipt} loading={!loaded} />
}

export function RecoveryHandoff({receipt, loading = false}: {receipt?: RestoreLaunch; loading?: boolean}) {
  const { t, date, label, diagnostic } = useRecoveryPresentation()
  const accepted = receipt?.phase === 'accepted'
  const pending = loading || receipt?.phase === 'starting' || accepted
  return <div className={ops.console}>
    <Link href="/vbr/activity" className={styles.returnLink}><ArrowLeft size={15} />{t('Activity')}</Link>
    <header className={ops.header}><div><h1>{receipt ? label(receipt.operation) : t('Recovery request')}</h1>
      {receipt && <p>{receipt.workload}</p>}</div></header>
    <section className={ops.panel}>
      <div className={styles.launchStatus} role={pending ? 'status' : 'alert'}>
        {!pending && <TriangleAlert aria-hidden size={23} />}
        <div><h2>{pending ? t('Preparing recovery') : receipt?.phase === 'rejected' ? t('Recovery request failed.') : t('Recovery status unconfirmed')}</h2>
          {!pending && <p>{receipt?.phase === 'rejected' ? diagnostic(receipt.message || t('Recovery request failed.')) : t('Check Activity before submitting another request.')}</p>}
          {!pending && receipt?.phase === 'unknown' && receipt.message && <p>{diagnostic(receipt.message)}</p>}
          {!pending && <Button asChild variant="outline" size="sm"><Link href="/vbr/activity">{t('View activity')}</Link></Button>}
        </div>
      </div>
      {pending && receipt && <ol className={styles.launchSteps} aria-label={t('Recovery request')}>
        <li><CalendarCheck aria-hidden/><div><strong>{t('Selected restore point')}</strong>
          {receipt.pointTime ? <time dateTime={receipt.pointTime}>{date(receipt.pointTime)}</time> : <small>{t('Not reported')}</small>}</div></li>
        <li aria-current={accepted ? undefined : 'step'}>{accepted ? <Check aria-hidden/> : <Loader2 className="motion-safe:animate-spin" aria-hidden/>}
          <div><strong>{t('Recovery request')}</strong><small>{accepted ? t('VBR accepted the request.') : t('Waiting for the recovery session from VBR.')}</small></div></li>
        <li aria-current={accepted ? 'step' : undefined}><FileText aria-hidden/><div><strong>{t('Session log')}</strong>
          <small>{t('Opens automatically when VBR returns the session.')}</small></div></li>
      </ol>}
    </section>
  </div>
}
