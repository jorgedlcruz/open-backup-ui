export type RpoUnit = 'minutes' | 'hours' | 'days'
export type RpoThreshold = { value: number; unit: RpoUnit }
const minutes: Record<RpoUnit, number> = { minutes: 1, hours: 60, days: 1440 }
export const thresholdHours = (threshold: RpoThreshold) => threshold.value * minutes[threshold.unit] / 60

export function normalizeThreshold(value: number, unit: RpoUnit): RpoThreshold {
  let total = Math.max(1, Math.min(99999 * 1440, Number.isFinite(value) ? value * minutes[unit] : 1))
  if (total >= 1440) { unit = 'days'; total /= 1440 }
  else if (total >= 60) { unit = 'hours'; total /= 60 }
  else unit = 'minutes'
  return { value: total, unit }
}

export function stepThreshold(threshold: RpoThreshold, direction: 1 | -1): RpoThreshold {
  const unit = direction < 0 && threshold.value <= 1
    ? threshold.unit === 'days' ? 'hours' : 'minutes'
    : threshold.unit
  return normalizeThreshold(threshold.value * minutes[threshold.unit] / minutes[unit] + direction, unit)
}

export function workloadLabel(name: string): string[] {
  const remaining = Array.from(name.trim()), lines: string[] = []
  while (remaining.length && lines.length < 3) {
    if (lines.length === 2 && remaining.length > 14) { lines.push(remaining.slice(0, 13).join('') + '…'); break }
    const chunk = remaining.slice(0, 14).join('')
    const boundary = Math.max(chunk.lastIndexOf('-'), chunk.lastIndexOf('_'), chunk.lastIndexOf(' '))
    const length = remaining.length > 14 && boundary >= 6 ? boundary + 1 : 14
    lines.push(remaining.splice(0, length).join('').trim())
  }
  return lines
}
