'use client'
// Open Backup UI v1.0.2

import { useI18n } from '@/components/providers/i18n-provider'
import { recoveryAge, recoveryBytes, recoveryDate, recoveryDiagnostic, recoveryGB, recoveryLabel } from './presentation'

export function useRecoveryPresentation() {
  const i18n = useI18n()
  const { t, locale } = i18n
  return {
    ...i18n,
    date: (value: string | number | null | undefined) => recoveryDate(t, value, locale),
    age: (hours: number | null) => recoveryAge(t, hours, locale),
    size: (value: unknown) => recoveryBytes(t, value, locale),
    gb: (value: number | null | undefined) => recoveryGB(t, value, locale),
    label: (value: string) => recoveryLabel(t, value, locale),
    diagnostic: (value: string) => recoveryDiagnostic(t, value, locale),
  }
}
