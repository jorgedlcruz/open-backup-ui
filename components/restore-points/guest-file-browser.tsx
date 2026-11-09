'use client'
// Open Backup UI v1.0.2

import { useEffect, useState } from 'react'
import { readWorkspace, workspaceKey, type GuestWorkspace } from '@/lib/restore-points/guest-workspace'
import { GuestFileExplorer } from './guest-file-explorer'
import { GuestRecoveryCart } from './guest-recovery-cart'
import { useRecoveryPresentation } from './use-presentation'
import styles from './workflow.module.css'

type BrowserProps = { sessionId: string; sourceKey: string }

export function GuestFileBrowser(props: BrowserProps) {
  return <MountedBrowser key={props.sourceKey + props.sessionId} {...props} />
}

function MountedBrowser(props: BrowserProps) {
  const [initial, setInitial] = useState<GuestWorkspace>()
  const storageKey = workspaceKey(props.sourceKey, props.sessionId)
  useEffect(() => {
    try { setInitial(readWorkspace(sessionStorage.getItem(storageKey))) }
    catch { setInitial({ cart: [] }) }
  }, [storageKey])
  return initial ? <Browser {...props} storageKey={storageKey} initial={initial} /> : null
}

function Browser({ sessionId, sourceKey, initial, storageKey }: BrowserProps & { initial: GuestWorkspace; storageKey: string }) {
  const { t } = useRecoveryPresentation()
  const [workspace, setWorkspace] = useState(initial)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(workspace)) }
    catch { /* The current tab still holds the cart in memory. */ }
    window.dispatchEvent(new CustomEvent('guest-workspace-changed', { detail: { storageKey, workspace } }))
  }, [storageKey, workspace])
  return <section className={styles.browser}>
    <div className={styles.bar}><h3>{t('Guest file restore')}</h3>
      <GuestRecoveryCart sessionId={sessionId} sourceKey={sourceKey} workspace={workspace} setWorkspace={setWorkspace} ready={ready}/>
    </div>
    <GuestFileExplorer sessionId={sessionId} sourceKey={sourceKey} workspace={workspace} setWorkspace={setWorkspace} onMountAvailable={setReady}/>
  </section>
}
