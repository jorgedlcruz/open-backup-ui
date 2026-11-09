'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Monitor, Power } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/components/providers/i18n-provider'
import { consolePage, consoleSetupPath, managementLink, readVmwareDestination, type ConsoleTarget, type VmwareDestination } from './vmware-console-api'
import styles from './session.module.css'

export function VmwareConsoleActions({sessionId, mountId, sourceKey, revision, mountName}: ConsoleTarget & {revision: number; mountName?: string}) {
  const {t} = useI18n()
  const [destination, setDestination] = useState<VmwareDestination | null>()
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>, busy = false
    async function read() {
      if (busy || document.hidden || controller.signal.aborted) return
      clearTimeout(timer)
      busy = true
      try {
        const result = await readVmwareDestination({sessionId, mountId, sourceKey}, controller.signal)
        if (!controller.signal.aborted) setDestination(result.destination)
      } catch {
        if (!controller.signal.aborted) setDestination(null)
      } finally {
        busy = false
        if (!controller.signal.aborted) timer = setTimeout(read, 30000)
      }
    }
    void read()
    document.addEventListener('visibilitychange', read)
    return () => {controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', read)}
  }, [mountId, revision, sessionId, sourceKey])
  if (destination === undefined) return null
  const power = destination?.powerState
  const powerLabel = power === 'on' ? t('Powered on') : power === 'off' ? t('Powered off') : power === 'suspended' ? t('Suspended') : t('VM power unknown')
  const management = managementLink(destination)
  return <div className={styles.vmConsoleActions}>
    {mountName && <strong>{mountName}</strong>}
    <span className={styles.vmPower} data-on={power === 'on' || undefined}><Power size={13} aria-hidden/>{destination ? powerLabel : t('Destination VM unavailable')}</span>
    {power === 'on' && destination?.consolePermitted && destination.consoleConfigured && <Button size="sm" asChild><a href={consolePage({sessionId, mountId, sourceKey})}
      target="_blank" rel="noopener noreferrer"><Monitor size={15}/>{t('Open web console')}</a></Button>}
    {management && <Button size="sm" variant="outline" asChild><a href={management} target="_blank" rel="noopener noreferrer">
      <ExternalLink size={14}/>{destination?.managerType === 'vcenter' ? t('Open in vCenter') : t('Open in ESXi')}</a></Button>}
    {(!management || power === 'on') && destination?.consolePermitted && !destination.consoleConfigured &&
      <Link className={styles.related} href={consoleSetupPath}>{t('Set up web console')}</Link>}
  </div>
}
