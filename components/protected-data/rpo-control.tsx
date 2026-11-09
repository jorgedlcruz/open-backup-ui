'use client'
// Open Backup UI v1.0.2

import { useI18n } from "@/components/providers/i18n-provider"

import { useEffect, useRef } from 'react'
import { normalizeThreshold, stepThreshold, type RpoThreshold, type RpoUnit } from '@/lib/protected-data/rpo'

export function RpoControl({ value, onChange }: { value: RpoThreshold; onChange: (value: RpoThreshold) => void }) {
  const { t } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const field = input.current
    if (!field) return
    const wheel = (event: WheelEvent) => {
      if (document.activeElement !== field || !event.deltaY) return
      event.preventDefault()
      onChange(stepThreshold(value, event.deltaY < 0 ? 1 : -1))
    }
    field.addEventListener('wheel', wheel, { passive: false })
    return () => field.removeEventListener('wheel', wheel)
  }, [value, onChange])
  return <>
    <label>{t("RPO threshold")}<input ref={input} aria-label={t("RPO threshold")} title={t("Use the arrows or scroll while focused. Minutes roll into hours, then days.")} type="number" min={1} max={99999} step="any" value={value.value}
      onChange={event => { if (event.target.value) onChange(Number(event.target.value) < 1 && value.value === 1 ? stepThreshold(value, -1) : normalizeThreshold(Number(event.target.value), value.unit)) }}
      onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); onChange(stepThreshold(value, event.key === 'ArrowUp' ? 1 : -1)) } }} /></label>
    <label>{t("Unit")}<select aria-label={t("RPO unit")} value={value.unit} onChange={event => onChange(normalizeThreshold(value.value, event.target.value as RpoUnit))}><option value="minutes">{t("Minutes")}</option><option value="hours">{t("Hours")}</option><option value="days">{t("Days")}</option></select></label>
  </>
}
