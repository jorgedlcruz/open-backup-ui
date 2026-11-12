// Open Backup UI v1.2.0
import type { MessageValues } from '../i18n/model'
import { enumLabel } from '../i18n/presentation'
import type { TopologyEntity } from './model'
type Translator = (source: string, values?: MessageValues) => string

type NumberFormat = (value: number, options?: Intl.NumberFormatOptions) => string
export function topologyText(t: Translator, value: string, number: NumberFormat = String) {
  const count = value.match(/^(\d+) restore points$/)
  if (count) return t('{count} restore points', { count: number(Number(count[1])) })
  const kinds: Record<string, string> = { workload: 'Workload', job: 'Job', repository: 'Repository' }
  return kinds[value] ? t(kinds[value]) : t(enumLabel(t, value))
}

export function topologyName(t: Translator, entity?: TopologyEntity) {
  if (!entity) return t('Unknown')
  if (entity.nameFallback === 'Job details unavailable') return t('Job details unavailable')
  if (entity.nameFallback === 'Repository details unavailable') return t('Repository details unavailable')
  return entity.name
}

export function topologyFactLabel(t: Translator, label: string) {
  return label === 'Free space' ? t('Free space') : t(label)
}

/** Numeric evidence is carried separately so server-side number punctuation is never parsed. */
export function topologyFact(t: Translator, fact: TopologyEntity['facts'][number], number: NumberFormat) {
  if (fact.numericValue !== undefined && Number.isFinite(fact.numericValue)) {
    if (fact.label === 'Capacity used') return number(fact.numericValue / 100, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })
    if (fact.label === 'Free space') return `${number(fact.numericValue)} GB`
    if (fact.label === 'Restore points reported') return number(fact.numericValue)
  }
  return topologyText(t, fact.value, number)
}
