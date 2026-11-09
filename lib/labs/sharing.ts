// Open Backup UI v1.0.2
import type { Board, Widget } from './model'
import type { Presentation } from './presentation'
import type { ThemeType } from '../themes'

export type PublicKiosk = {
  name: string; updatedAt: string; refresh: Board['refresh']; gap: number; theme: ThemeType; mode: 'light' | 'dark'
  widgets: { widget: Widget; presentation?: Presentation; error?: string }[]
}
export type SharedLink = { id: string; name: string; url: string; protected: boolean; updatedAt: string }

export { publicPathAllowed } from './public-paths.cjs'
export function configuredPublicOrigin(value?: string) {
  if (!value) return null
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('KIOSK_PUBLIC_ORIGIN must be an HTTP(S) origin without a path.')
  return url.origin
}
