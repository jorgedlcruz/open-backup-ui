// Open Backup UI v1.0.2
export const LOCALES = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
] as const

export type Locale = typeof LOCALES[number]['code']
export type LocalePreference = Locale | 'auto'
export type MessageValues = Record<string, string | number>
export type Messages = Readonly<Record<string, string>>
export const LOCALE_COOKIE = 'open-backup-ui-language'

export function normalizeLocale(value: unknown): Locale | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/_/g, '-').toLowerCase()
  const exact = LOCALES.find(locale => locale.code.toLowerCase() === normalized)
  if (exact) return exact.code
  const language = normalized.split('-')[0]
  if (language === 'pt') return 'pt-BR'
  if (language === 'zh') return 'zh-CN'
  return LOCALES.find(locale => locale.code === language)?.code ?? null
}

export function normalizePreference(value: unknown): LocalePreference {
  // Persist only canonical values, never arbitrary cookie content.
  return LOCALES.find(locale => locale.code === value)?.code ?? 'auto'
}

export function detectLocale(languages: string | readonly string[] | null | undefined): Locale {
  const choices = typeof languages === 'string' ? languages.split(',').map((entry, index) => {
    const [language, ...parameters] = entry.trim().split(';')
    const quality = parameters.find(parameter => parameter.trim().startsWith('q='))
    const weight = quality ? Number(quality.trim().slice(2)) : 1
    return { language, weight: Number.isFinite(weight) && weight >= 0 && weight <= 1 ? weight : 0, index }
  }).filter(choice => choice.weight > 0).sort((a, b) => b.weight - a.weight || a.index - b.index).map(choice => choice.language) : languages ?? []
  for (const choice of choices) {
    const locale = normalizeLocale(choice)
    if (locale) return locale
  }
  return 'en'
}

export function resolveLocale(preference: unknown, languages?: string | readonly string[] | null): Locale {
  const selected = normalizePreference(preference)
  return selected === 'auto' ? detectLocale(languages) : selected
}

export function translate(messages: Messages, source: string, values?: MessageValues): string {
  const message = Object.prototype.hasOwnProperty.call(messages, source) && typeof messages[source] === 'string' && messages[source] ? messages[source] : source
  // One substitution pass keeps user-provided text literal (including braces and dollar signs).
  return message.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (placeholder, key: string) => values && Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : placeholder)
}
