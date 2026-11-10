// Open Backup UI v1.0.2
import type {ReactNode} from 'react'
import type {RecoveryKind} from '@/lib/restore-points/recovery-picker'
import styles from './recovery-kind-art.module.css'

const drawings:Record<RecoveryKind,ReactNode>={
  'instant-vm': <>
    <path className={styles.shade} d="M16 30h9l1.5 6.5h-12z"/>
    <path className={styles.metal} d="M11 37h19l2 2.5H9z"/>
    <rect className={styles.metal} x="4" y="9" width="33" height="23" rx="3.5"/>
    <rect className={styles.glass} x="7.5" y="12.5" width="26" height="15.5" rx="1.5"/>
    <path className={styles.detail} d="M11 17h8m-8 3.5h3.5"/>
    <path className={styles.accent} d="m39 16-13 16h7l-2 10 13-17h-7z"/>
  </>,
  'entire-vm': <>
    <path className={styles.metal} d="m22 5 16 8.5v17L22 39 6 30.5v-17z"/>
    <path className={styles.glass} d="m22 5 16 8.5-16 8.7-16-8.7z"/>
    <path className={styles.shade} d="m22 22.2 16-8.7v17L22 39z"/>
    <path className={styles.detail} d="m11 21 5.5 3m-5.5 1 3.5 1.9"/>
    <path className={styles.halo} d="M42 34a7 7 0 1 1-7-7h5.2m-3.4-3.5 3.6 3.5-3.6 3.5"/>
    <path className={styles.action} d="M42 34a7 7 0 1 1-7-7h5.2m-3.4-3.5 3.6 3.5-3.6 3.5"/>
  </>,
  'guest-files': <>
    <path className={styles.shade} d="M4.5 16a3 3 0 0 1 3-3H17l4 4h16.5a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3h-30a3 3 0 0 1-3-3z"/>
    <path className={styles.metal} d="M15 9.5h13l6 6v16.3H15z"/>
    <path className={styles.detail} d="M27.7 10v6h5.8m-14.5 3h8"/>
    <path className={styles.glass} d="M9 22.5h32a1.7 1.7 0 0 1 1.7 2.1L39 36.1a2.9 2.9 0 0 1-2.8 2H8.6a2.5 2.5 0 0 1-2.4-3.1z"/>
    <path className={styles.action} d="M13 27h9"/>
  </>,
  sql: <>
    <path className={styles.metal} d="M6 12.5v22c0 3.8 6.4 6.5 14.5 6.5S35 38.3 35 34.5v-22"/>
    <ellipse className={styles.glass} cx="20.5" cy="12.5" rx="14.5" ry="6.2"/>
    <path className={styles.line} d="M6 20c0 3.5 6.5 6.1 14.5 6.1S35 23.5 35 20M6 27.5c0 3.5 6.5 6.1 14.5 6.1"/>
    <rect className={styles.metal} x="24" y="25.5" width="18" height="14.5" rx="2"/>
    <path className={styles.glass} d="M26 25.5h14a2 2 0 0 1 2 2v2.5H24v-2.5a2 2 0 0 1 2-2z"/>
    <path className={styles.detail} d="M30 30v9.5M24.5 34.8h17"/>
  </>,
  'active-directory': <>
    <path className={styles.action} d="M24 18v7M8 31v-5a1 1 0 0 1 1-1h30a1 1 0 0 1 1 1v5M24 25v6"/>
    <path className={styles.glass} d="M16.5 7.5H23l2.2 2.3H31a1.5 1.5 0 0 1 1.5 1.5V17a1.5 1.5 0 0 1-1.5 1.5H16.5A1.5 1.5 0 0 1 15 17V9a1.5 1.5 0 0 1 1.5-1.5z"/>
    {[8,24,40].map(x=><g key={x}><rect className={styles.metal} x={x-5.7} y="31" width="11.4" height="9.5" rx="2"/><path className={styles.detail} d={`M${x-2.5} 34.5h5`}/></g>)}
  </>,
  'instant-disk': <>
    <path className={styles.shade} d="M8 12.8a3.3 3.3 0 0 1 3.3-3.3h19.3a3.3 3.3 0 0 1 3.3 3.3V36l-2.8 3H11.3A3.3 3.3 0 0 1 8 35.7z"/>
    <rect className={styles.metal} x="6" y="7.5" width="25.5" height="29.3" rx="3.2"/>
    <circle className={styles.glass} cx="18.7" cy="20.2" r="8.1"/>
    <circle className={styles.metal} cx="18.7" cy="20.2" r="2.2"/>
    <path className={styles.line} d="m25.6 29.8-5.4-7.6m-9.4 10.4H15"/>
    <path className={styles.accent} d="m39 20-11.5 13h6l-1.8 9 11.8-15h-6.2z"/>
  </>,
  'publish-disks': <>
    <path className={styles.metal} d="M5 29.5 10 19h21l5 10.5v4.8a2.2 2.2 0 0 1-2.2 2.2H7.2A2.2 2.2 0 0 1 5 34.3z"/>
    <path className={styles.shade} d="M5 35h31v3.4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/>
    <path className={styles.glass} d="M10 19h21l5 10.5H5z"/>
    <path className={styles.detail} d="M9 32.6h4m-4.2 5.2h4.2"/>
    <path className={styles.halo} d="M20 25v-4a4 4 0 0 1 4-4h7.5a4 4 0 0 0 4-4V7m-5.4 5.4L35.5 7l5.4 5.4"/>
    <path className={styles.action} d="M20 25v-4a4 4 0 0 1 4-4h7.5a4 4 0 0 0 4-4V7m-5.4 5.4L35.5 7l5.4 5.4"/>
  </>,
}

export function RecoveryKindArt({kind}:{kind:RecoveryKind}){
  return <svg className={styles.art} width="48" height="48" viewBox="0 0 48 48" aria-hidden="true" focusable="false">{drawings[kind]}</svg>
}
