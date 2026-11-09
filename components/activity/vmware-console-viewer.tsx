'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Keyboard, Maximize2, Monitor, RefreshCw, Unplug } from 'lucide-react'
import type RFB from '@novnc/novnc'
import { useI18n } from '@/components/providers/i18n-provider'
import { Button } from '@/components/ui/button'
import { ApplicationRequestError } from '@/lib/api/application-request'
import { consoleSetupPath, issueConsoleTicket, managementLink, readVmwareDestination, type ConsoleTarget, type VmwareDestination } from './vmware-console-api'
import styles from './vmware-console.module.css'

const connectionFailed = 'Could not connect to the VMware console. Check browser access to the host and its TLS certificate.'
const accessDenied = 'Console access denied.'
const unavailable = 'Destination VM unavailable'

export function VmwareConsoleViewer({sessionId, mountId, sourceKey}: ConsoleTarget) {
  const {t} = useI18n()
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<'connecting' | 'connected' | 'closed' | 'error'>('connecting')
  const [issue, setIssue] = useState('')
  const [destination, setDestination] = useState<VmwareDestination | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false)
  const screen = useRef<HTMLDivElement>(null), viewer = useRef<HTMLElement>(null)
  const client = useRef<RFB | null>(null)
  const disconnect = useRef<() => void>(() => {})
  useEffect(() => {
    setFullscreenAvailable(document.fullscreenEnabled)
    const changed = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const target = {sessionId, mountId, sourceKey}
    let rfb: RFB | undefined, socket: WebSocket | undefined, done = false, connected = false
    let timeout: ReturnType<typeof setTimeout>
    const close = (message?: string) => {
      if (done) return
      done = true
      clearTimeout(timeout)
      controller.abort()
      client.current = null
      rfb?.disconnect()
      socket?.close()
      setIssue(message || '')
      setPhase(message ? 'error' : 'closed')
    }
    disconnect.current = () => close()
    window.addEventListener('pagehide', disconnect.current)
    async function connect() {
      setPhase('connecting'); setIssue(''); setDestination(null)
      try {
        const response = await readVmwareDestination(target, controller.signal)
        if (done) return
        const vm = response.destination
        setDestination(vm)
        if (!vm) return close(unavailable)
        if (!vm.consolePermitted) return close(accessDenied)
        if (vm.powerState !== 'on') return close('The destination VM must be powered on.')
        if (!vm.consoleConfigured) return close('VMware console connection required.')
        if (!window.isSecureContext) return close('Open Backup UI over HTTPS to use the web console.')
        const {default: RfbClient} = await import('@novnc/novnc')
        if (done || !screen.current) return
        const ticket = await issueConsoleTicket(target, controller.signal)
        if (done || !screen.current) return
        const endpoint = new URL(ticket.url)
        if (endpoint.protocol !== 'wss:' || endpoint.username || endpoint.password || endpoint.hash) return close(connectionFailed)
        // Passing a channel keeps the ticket URL out of noVNC's diagnostic messages.
        socket = new WebSocket(endpoint.href, ['binary'])
        rfb = new RfbClient(screen.current, socket)
        client.current = rfb
        rfb.scaleViewport = true
        rfb.addEventListener('connect', () => {
          if (done) return
          clearTimeout(timeout); connected = true
          setPhase('connected')
          rfb?.focus()
        })
        rfb.addEventListener('disconnect', () => close(connected ? undefined : connectionFailed))
        for (const event of ['securityfailure', 'credentialsrequired', 'serververification']) {
          rfb.addEventListener(event, () => close('VMware rejected the console handshake.'))
        }
        timeout = setTimeout(() => close(connectionFailed), 25000)
      } catch (error) {
        if (done) return
        if (error instanceof ApplicationRequestError) {
          if (error.status === 401 || error.status === 403) return close(accessDenied)
          if (error.status === 404 || error.status === 409) return close('The destination changed. Refresh the session and try again.')
        }
        close(connectionFailed)
      }
    }
    void connect()
    return () => {
      done = true
      window.removeEventListener('pagehide', disconnect.current)
      clearTimeout(timeout); controller.abort(); client.current = null
      rfb?.disconnect(); socket?.close()
    }
  }, [attempt, mountId, sessionId, sourceKey])
  const management = managementLink(destination)
  const status = phase === 'connecting' ? t('Connecting…') : phase === 'connected' ? t('Connected') : phase === 'closed' ? t('Disconnected') : t('Unavailable')
  return <main ref={viewer} className={styles.viewer}>
    <header className={styles.toolbar}>
      <div className={styles.identity}><Monitor size={20} aria-hidden/><div><h1>{destination?.name || t('VM web console')}</h1>
        <p role="status"><span data-connected={phase === 'connected' || undefined}/>{status}</p></div></div>
      <div className={styles.actions}>
        {phase === 'connected' && <Button size="sm" variant="outline" onClick={() => {client.current?.sendCtrlAltDel(); client.current?.focus()}}>
          <Keyboard/>{t('Send Ctrl+Alt+Delete')}</Button>}
        {fullscreenAvailable && <Button variant="outline" size="sm" aria-label={fullscreen ? t('Exit full screen') : t('Full screen')}
          title={fullscreen ? t('Exit full screen') : t('Full screen')} onClick={() => {
            const change = document.fullscreenElement ? document.exitFullscreen() : viewer.current?.requestFullscreen()
            void change?.catch(() => setIssue('Full screen is unavailable in this browser.'))
          }}><Maximize2/></Button>}
        {(phase === 'connected' || phase === 'connecting') && <Button variant="outline" size="sm" onClick={() => disconnect.current()}><Unplug/>{t('Disconnect')}</Button>}
      </div>
    </header>
    <div ref={screen} className={styles.screen} aria-label={t('VM web console')}/>
    {(phase !== 'connected' || issue) && <section className={styles.overlay}>
      <div className={styles.message}><Monitor size={26} aria-hidden/>
        <p role={issue ? 'alert' : undefined}>{issue ? t(issue) : phase === 'connecting' ? t('Connecting…') : t('Disconnected')}</p>
        {phase !== 'connecting' && <div className={styles.actions}>
          {phase !== 'connected' && <Button size="sm" onClick={() => setAttempt(value => value + 1)}><RefreshCw/>{t('Reconnect')}</Button>}
          {management && <Button asChild size="sm" variant="outline"><a href={management} target="_blank" rel="noopener noreferrer"><ExternalLink/>{destination?.managerType === 'vcenter' ? t('Open in vCenter') : t('Open in ESXi')}</a></Button>}
          {destination?.consolePermitted && !destination.consoleConfigured && <Link href={consoleSetupPath}>{t('Set up web console')}</Link>}
          {phase === 'connected' && <Button size="sm" onClick={() => setIssue('')}>{t('Close')}</Button>}
        </div>}
      </div>
    </section>}
  </main>
}
