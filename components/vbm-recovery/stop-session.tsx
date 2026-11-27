'use client'
// Open Backup UI v1.3.0
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Loader2, MoreHorizontal, RefreshCw, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useI18n } from '@/components/providers/i18n-provider'
import type { RecoverySession } from '@/lib/vbm-recovery/model'
import { recoveryGet, recoveryPost } from './client'
import { createStopSessionController } from './stop-session-controller'
import css from './stop-session.module.css'

const stops = createStopSessionController({
  post: sessionId => recoveryPost({ action: 'stop', sessionId }),
  read: (sessionId, signal) => recoveryGet({ action: 'sessionState', sessionId }, signal),
})

const stopStatus = {
  submitting: 'Sending stop request…', waiting: 'Stop requested', unconfirmed: 'Stop outcome unconfirmed',
  failed: 'Stop request failed', stopped: 'Session stopped',
}

export function useSessionStop(session: Pick<RecoverySession, 'id' | 'state'>, poll = true) {
  const subscribe = useCallback((listener: () => void) => stops.subscribe(session.id, listener), [session.id])
  const snapshot = useCallback(() => stops.snapshot(session.id), [session.id])
  const state = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => stops.observe(session), [session.id, session.state, session])
  useEffect(() => {
    if (!poll || !['waiting', 'unconfirmed'].includes(state.phase) || state.checking || Date.now() > (state.pollUntil || 0)) return
    const timer = setTimeout(() => void stops.check(session.id), 3000)
    return () => clearTimeout(timer)
  }, [session.id, state, poll])
  return { ...state, request: () => stops.request(session.id), check: () => stops.check(session.id) }
}

export function SessionStopControl({ session, disabledReason, menu = false, href, operation = false, onStopped, feedback = true }: {
  session: RecoverySession
  disabledReason?: string
  menu?: boolean
  href?: string
  operation?: boolean
  onStopped?: () => void
  feedback?: boolean
}) {
  const { t } = useI18n(), stop = useSessionStop(session), [confirm, setConfirm] = useState(false)
  const stoppedCallback = useRef(onStopped); stoppedCallback.current = onStopped
  const notified = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (stop.phase === 'stopped' && stop.requestedAt && notified.current !== session.id) { notified.current = session.id; stoppedCallback.current?.() }
  }, [session.id, stop.phase, stop.requestedAt])
  const stopped = session.state === 'Stopped' || stop.phase === 'stopped'
  const pending = ['submitting', 'waiting', 'unconfirmed'].includes(stop.phase)
  const label = operation ? 'Stop operation' : session.context ? 'End browsing' : 'Stop session'
  const status = stop.phase === 'idle' ? label : stopStatus[stop.phase]
  return <div className={css.control}>
    {menu ? <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="ghost" aria-label={t('Session actions')}><MoreHorizontal size={17} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
      {href && <DropdownMenuItem asChild><Link href={href}><ArrowUpRight size={15} />{t('Open session')}</Link></DropdownMenuItem>}
      {!stopped && <><DropdownMenuSeparator /><DropdownMenuItem disabled={!!disabledReason || pending} onSelect={() => setConfirm(true)}><Square size={14} />{t(pending ? status : label)}</DropdownMenuItem></>}
      {pending && <DropdownMenuItem disabled={stop.checking || stop.phase === 'submitting'} onSelect={() => void stop.check()}><RefreshCw size={14} />{t('Check stop status')}</DropdownMenuItem>}
    </DropdownMenuContent></DropdownMenu> : !stopped && <Button size="sm" variant="outline" disabled={!!disabledReason || pending} title={disabledReason ? t(disabledReason) : undefined} onClick={() => setConfirm(true)}>{pending && feedback ? <Loader2 size={14} className={css.spin} /> : <Square size={14} />}{t(pending && feedback ? status : label)}</Button>}
    {feedback && <SessionStopFeedback session={session}/>}
    <AlertDialog open={confirm} onOpenChange={setConfirm}><AlertDialogContent><AlertDialogHeader>
      <AlertDialogTitle>{t(operation ? 'Stop this restore operation?' : 'End this browse session?')}</AlertDialogTitle>
      <AlertDialogDescription>{t(operation ? 'This stops only the selected operation. The backup explorer stays open.' : 'Close the backup explorer after your recovery operations have finished. Starting again creates a new browse session.')}</AlertDialogDescription>
    </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t(operation ? 'Keep running' : 'Keep browsing')}</AlertDialogCancel><AlertDialogAction disabled={pending || !!disabledReason} onClick={() => void stop.request()}>{t(label)}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}

/** Feedback can sit beside session diagnostics while actions stay in the row menu. */
export function SessionStopFeedback({session,inline=false,className}:{session:Pick<RecoverySession,'id'|'state'>;inline?:boolean;className?:string}) {
  const {t}=useI18n(),stop=useSessionStop(session,false)
  if(stop.requestedAt===undefined || stop.phase==='idle')return null
  const pending=['submitting','waiting','unconfirmed'].includes(stop.phase)
  const status=stopStatus[stop.phase]
  const detail=stop.phase==='submitting'?'Waiting for Veeam to acknowledge the stop request.':stop.phase==='waiting'?'Veeam accepted the request. Waiting for the session to report Stopped.':stop.phase==='unconfirmed'?'The stop request could not be confirmed. Check its status before trying again.':undefined
  return <div className={className ?? (inline?css.inlineFeedback:css.feedback)} role="status" data-phase={stop.phase} data-error={stop.phase==='failed'||stop.phase==='unconfirmed'}>
    <strong>{pending&&<Loader2 size={13} className={css.spin}/>} {t(status)}</strong>
    {detail&&<span>{t(detail)}</span>}
    {stop.error&&stop.error!==detail&&<span>{t(stop.error)}</span>}
    {pending&&stop.phase!=='submitting'&&<Button size="sm" variant="ghost" disabled={stop.checking} onClick={()=>void stop.check()}>{stop.checking&&<Loader2 size={13} className={css.spin}/>} {t('Check stop status')}</Button>}
  </div>
}
