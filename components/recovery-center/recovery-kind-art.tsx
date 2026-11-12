// Open Backup UI v1.2.0
import type { ReactNode } from 'react'
import type { RecoveryKind } from '@/lib/restore-points/recovery-picker'
import styles from './recovery-kind-art.module.css'

const drawings = {
  'instant-vm': (
    <>
      <rect x="5" y="7" width="38" height="27" rx="4" />
      <path d="M24 34v7m-9 0h18" />
      <path d="m27 11-10 11h7l-2 8 10-12h-7z" />
    </>
  ),
  'entire-vm': (
    <>
      <path d="M12 8V7a3 3 0 0 1 3-3h24a4 4 0 0 1 4 4v19a3 3 0 0 1-3 3" />
      <rect x="5" y="11" width="32" height="25" rx="4" />
      <path d="M21 36v6m-8 0h16" />
      <path d="M15 23a6.5 6.5 0 1 1 1.6 5.2M15 17.5V23h5.5" />
    </>
  ),
  'guest-files': (
    <>
      <path d="M5 22v-7a4 4 0 0 1 4-4h8l5 5h14a4 4 0 0 1 4 4" />
      <path d="M5 22h36a2 2 0 0 1 2 2.5L40 35a4 4 0 0 1-4 3H10a4 4 0 0 1-4-3.7z" />
    </>
  ),
  sql: (
    <>
      <ellipse cx="24" cy="11" rx="15.5" ry="5.5" />
      <path d="M8.5 11v25c0 3 7 5.5 15.5 5.5S39.5 39 39.5 36V11" />
      <path d="M8.5 23.5C8.5 26.5 15.5 29 24 29s15.5-2.5 15.5-5.5" />
    </>
  ),
  'active-directory': (
    <>
      <path d="M18 6h5l2.5 3H30a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H18a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
      <path d="M24 18v7M10 32v-5a2 2 0 0 1 2-2h24a2 2 0 0 1 2 2v5" />
      <rect x="4" y="32" width="12" height="9" rx="2" />
      <rect x="32" y="32" width="12" height="9" rx="2" />
    </>
  ),
  'instant-disk': (
    <>
      <rect x="9" y="4.5" width="30" height="39" rx="5" />
      <path d="M32.7 20.7a9.3 9.3 0 1 0-9.1 8.1" />
      <circle cx="23.5" cy="19.5" r="2" />
      <path d="m26.5 23.5 6.8 5.4a2.2 2.2 0 1 1-3.5 2.4zM15 37h6" />
    </>
  ),
  'publish-disks': (
    <>
      <path d="M24 23V5m-7 7 7-7 7 7" />
      <path d="M17 18h-4a4 4 0 0 0-3.5 2L5 29m26-11h4a4 4 0 0 1 3.5 2l4.5 9" />
      <rect x="4.5" y="27.5" width="39" height="13" rx="3.5" />
      <path d="M11 34h6" />
    </>
  ),
}

export function RecoveryKindArt({ kind }: { kind: RecoveryKind }) {
  const icon=kind==='agent-volumes'?'instant-disk':kind.endsWith('-files')?'guest-files':kind.startsWith('nas-')||kind.startsWith('object-')?'entire-vm':kind
  return (
    <svg className={styles.art} width="48" height="48" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      {drawings[icon as keyof typeof drawings] satisfies ReactNode}
    </svg>
  )
}
