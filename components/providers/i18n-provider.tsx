'use client'
// Open Backup UI v1.2.0

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { catalogs } from '@/lib/i18n/catalogs'
import { detectLocale, LOCALE_COOKIE, normalizePreference, translate, type Locale, type LocalePreference, type MessageValues } from '@/lib/i18n/model'

type I18nContextValue = {
  locale: Locale
  preference: LocalePreference
  setLocale: (preference: LocalePreference) => void
  t: (source: string, values?: MessageValues) => string
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string
}

const defaultValue: I18nContextValue = {
  locale: 'en', preference: 'auto', setLocale: () => {},
  t: (source, values) => translate(catalogs.en, source, values),
  formatNumber: (value, options) => new Intl.NumberFormat('en', options).format(value),
  formatDate: (value, options) => new Intl.DateTimeFormat('en', options).format(new Date(value)),
}
const I18nContext = createContext<I18nContextValue>(defaultValue)

export function I18nProvider({ children, initialLocale = 'en', initialPreference = 'auto' }: { children: ReactNode; initialLocale?: Locale; initialPreference?: LocalePreference }) {
  const [locale, setResolvedLocale] = useState<Locale>(initialLocale)
  const [preference, setPreference] = useState<LocalePreference>(initialPreference)

  const setLocale = useCallback((selection: LocalePreference) => {
    const next = normalizePreference(selection)
    setPreference(next)
    setResolvedLocale(next === 'auto' ? detectLocale(navigator.languages) : next)
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`
    try { localStorage.setItem(LOCALE_COOKIE, next) } catch { /* Cookies still persist when local storage is unavailable. */ }
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== LOCALE_COOKIE) return
      const next = normalizePreference(event.newValue)
      setPreference(next)
      setResolvedLocale(next === 'auto' ? detectLocale(navigator.languages) : next)
    }
    const onLanguageChange = () => {
      if (preference === 'auto') setResolvedLocale(detectLocale(navigator.languages))
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('languagechange', onLanguageChange)
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('languagechange', onLanguageChange) }
  }, [preference])

  const value = useMemo<I18nContextValue>(() => ({
    locale, preference, setLocale,
    t: (source, values) => translate(catalogs[locale], source, values),
    formatNumber: (number, options) => new Intl.NumberFormat(locale, options).format(number),
    formatDate: (date, options) => new Intl.DateTimeFormat(locale, options).format(new Date(date)),
  }), [locale, preference, setLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() { return useContext(I18nContext) }

/** Explicit UI copy only; never pass workload names, server messages, or other API data. */
export function Trans({ children, values }: { children: string; values?: MessageValues }) {
  const { t } = useI18n()
  const source = children.trim()
  if (!source) return <>{children}</>
  return <>{children.slice(0, children.indexOf(source))}{t(source, values)}{children.slice(children.indexOf(source) + source.length)}</>
}
