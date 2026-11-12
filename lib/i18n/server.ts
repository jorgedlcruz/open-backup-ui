// Open Backup UI v1.2.0
import { cookies, headers } from 'next/headers'
import { catalogs } from './catalogs'
import { LOCALE_COOKIE, resolveLocale, translate, type MessageValues } from './model'

/** Keep route metadata in the same language as the server-rendered interface. */
export async function getRequestI18n() {
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()])
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, requestHeaders.get('accept-language'))
  return { locale, t: (source: string, values?: MessageValues) => translate(catalogs[locale], source, values) }
}
