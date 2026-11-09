// Open Backup UI v1.0.2
import { LOCALES, normalizeLocale, type Locale } from '../i18n/model'
import type { Translator } from '../i18n/presentation'

/** Language comes only from the shipped locale list, never arbitrary prompt text. */
export function healthSummaryLanguageInstruction(value: unknown) {
  const locale = normalizeLocale(value) || 'en'
  const language = LOCALES.find(item => item.code === locale)!
  return `Write all narrative content, recommendations and evidence summaries in ${language.name} (${language.code}). Preserve resource names, product names, IDs, paths and quoted source diagnostics exactly. Keep the four required section headings and the Confidence, Recommendation and Urgent markers in English as parsing identifiers; the interface translates those markers. Do not infer the response language from the telemetry.`
}

/** Only the four section identifiers specified by our generation protocol are localized. */
export function healthSectionTitle(t: Translator, title: string) {
  switch (title.trim().toLowerCase()) {
    case 'overview': return t('Overview')
    case 'operations health': return t('Operations Health')
    case 'security posture': return t('Security Posture')
    case 'audit events': return t('Audit Events')
    default: return title
  }
}

export function healthConfidence(t: Translator, value: string, locale: Locale) {
  const match = /^\s*Confidence:\s*(\d{1,3}(?:\.\d+)?)\s*%\s*$/i.exec(value)
  if (!match || Number(match[1]) > 100) return null
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(Number(match[1]) / 100)
  return t('Confidence: {percent}', { percent })
}

export function healthAlertPrefix(t: Translator, value: string) {
  return value.replace(/^(\s*)(Recommendation|Urgent)(:|$)/i, (_, whitespace: string, marker: string, colon: string) => {
    const translated = marker.toLowerCase() === 'urgent' ? t('Urgent:') : t('Recommendation:')
    // Markdown may put the marker in bold and its colon in the next text node.
    return whitespace + (colon ? translated : translated.replace(/\s*[:：]\s*$/, ''))
  })
}

export function healthSummaryError(t: Translator, value: string) {
  switch (value) {
    case 'AI API Key is missing. Please configure it in Administration > AI Integrations.': return t('AI API Key is missing. Please configure it in Administration > AI Integrations.')
    case 'Authorization required. Please log in again.': return t('Authorization required. Please log in again.')
    case 'Unknown error during AI generation': return t('Unknown error during AI generation')
    case 'Failed to generate AI summary': return t('Failed to generate AI summary')
    case 'No readable stream returned by API': return t('No readable stream returned by API')
    case 'The provider returned no summary text. Check AI Integrations and try again.': return t('The provider returned no summary text. Check AI Integrations and try again.')
    case 'The AI response was interrupted. Retry to generate a complete summary.': return t('The AI response was interrupted. Retry to generate a complete summary.')
    default: return value
  }
}
