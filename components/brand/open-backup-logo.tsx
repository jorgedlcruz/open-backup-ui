"use client"
// Open Backup UI v1.2.0

import { useId } from "react"
import styles from "./open-backup-logo.module.css"

/** Interlock: restore-arrow O, checked B, and an outlined geometric wordmark. */
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
    {!compact && <svg className={styles.wordmark} viewBox="0 0 720 132" aria-hidden="true" focusable="false">
      <g fill="currentColor" fillRule="evenodd"><path transform="translate(0)" d="M34 0C13 0 0 16 0 40S13 80 34 80S68 64 68 40S55 0 34 0ZM34 17C45 17 50 25 50 40S45 63 34 63S18 55 18 40S23 17 34 17Z" /><path transform="translate(75)" d="M0 0H30C49 0 60 11 60 28S49 56 30 56H18V80H0ZM18 17V39H29C38 39 42 35 42 28S38 17 29 17Z" /><path transform="translate(142)" d="M0 0H52V17H18V31H48V48H18V63H52V80H0Z" /><path transform="translate(201)" d="M0 80V0H18L48 48V0H66V80H48L18 32V80Z" /><path transform="translate(297)" d="M0 0H32C51 0 60 8 60 21C60 29 56 35 50 38C59 41 63 47 63 57C63 72 53 80 33 80H0ZM18 16V31H30C38 31 42 29 42 23.5S38 16 30 16ZM18 47V64H32C41 64 45 61 45 55.5S41 47 32 47Z" /><path transform="translate(367)" d="M0 80L26 0H44L70 80H51L47 65H23L19 80ZM28 48H42L35 23Z" /><path transform="translate(444)" d="M65 14L53 26C48 20 43 17 35 17C24 17 18 26 18 40S24 63 35 63C43 63 49 60 54 54L65 66C57 76 48 80 34 80C13 80 0 64 0 40S13 0 34 0C48 0 58 5 65 14Z" /><path transform="translate(516)" d="M0 0H18V31L44 0H65L34 37L66 80H44L22 49L18 54V80H0Z" /><path transform="translate(588)" d="M0 0H18V49C18 59 22 63 32.5 63S47 59 47 49V0H65V50C65 70 54 80 32.5 80S0 70 0 50Z" /><path transform="translate(660)" d="M0 0H30C49 0 60 11 60 28S49 56 30 56H18V80H0ZM18 17V39H29C38 39 42 35 42 28S38 17 29 17Z" /></g>
      <g className={styles.accent} fillRule="evenodd"><g transform="translate(675 92) scale(.5)"><path d="M0 0H18V49C18 59 22 63 32.5 63S47 59 47 49V0H65V50C65 70 54 80 32.5 80S0 70 0 50Z"/><path transform="translate(72)" d="M0 0H18V80H0Z"/></g></g>
    </svg>}
  </span>
}
