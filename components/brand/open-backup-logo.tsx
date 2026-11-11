"use client"
// Open Backup UI v1.2.0

import { useId } from "react"
import styles from "./open-backup-logo.module.css"

/** Interlock: restore-arrow O, checked B, with the original application name. */
export function OpenBackupLogo({ compact = false }: { compact?: boolean }) {
  const cutout = useId()
  return <span className={styles.logo} data-compact={compact} role="img" aria-label="Open Backup UI">
    <svg className={styles.mark} viewBox="0 0 132 118" aria-hidden="true" focusable="false">
      <defs><mask id={cutout} maskUnits="userSpaceOnUse" x="0" y="0" width="132" height="118">
        <rect width="132" height="118" fill="white" />
        <path d="M55 3H86C107 3 120 15 120 30C120 40 114 47 107 51C119 56 125 65 125 76C125 88 113 94 95 94H65V84C65 69 71 59 81 53C74 42 66 35 55 31Z" fill="black" stroke="black" strokeWidth="5" strokeLinejoin="round" />
      </mask></defs>
      <path className={styles.accent} d="M16 44A43 43 0 1 0 31 31L31 48A26 26 0 1 1 28 55ZM31 16V48L8 36Z" mask={`url(#${cutout})`} />
      <path d="M55 3H86C107 3 120 15 120 30C120 40 114 47 107 51C119 56 125 65 125 76C125 88 113 94 95 94H65V84C65 69 71 59 81 53C74 42 66 35 55 31ZM77 19V36H87C96 36 101 33 101 27.5C101 22 96 19 87 19ZM78 68L84 62L91 69L106 54L112 60L91 81Z" fill="currentColor" fillRule="evenodd" />
    </svg>
    {!compact && <span className={styles.label} aria-hidden="true">Open Backup UI</span>}
  </span>
}
