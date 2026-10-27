'use client'

import { useEffect, useRef } from 'react'
import { normalizeThreshold, stepThreshold, type RpoThreshold, type RpoUnit } from '@/lib/protected-data/rpo'

export function RpoControl({ value, onChange }: { value: RpoThreshold; onChange: (value: RpoThreshold) => void }) {
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
    <label>RPO threshold<input ref={input} aria-label="RPO threshold" title="Use the arrows or scroll while focused. Minutes roll into hours, then days." type="number" min={1} max={99999} step="any" value={value.value}
      onChange={event => { if (event.target.value) onChange(Number(event.target.value) < 1 && value.value === 1 ? stepThreshold(value, -1) : normalizeThreshold(Number(event.target.value), value.unit)) }}
      onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); onChange(stepThreshold(value, event.key === 'ArrowUp' ? 1 : -1)) } }} /></label>
    <label>Unit<select aria-label="RPO unit" value={value.unit} onChange={event => onChange(normalizeThreshold(value.value, event.target.value as RpoUnit))}><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option></select></label>
  </>
}
