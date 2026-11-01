import { NextRequest, NextResponse } from 'next/server'
import { configuredPublicOrigin, publicPathAllowed } from './lib/labs/sharing'

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  let publicOrigin: string | null
  try { publicOrigin = configuredPublicOrigin(process.env.KIOSK_PUBLIC_ORIGIN) }
  catch { return new NextResponse('Invalid public kiosk origin configuration.', { status: 503 }) }
  const host = request.headers.get('host') || request.nextUrl.host
  if (publicOrigin && host.toLowerCase() === new URL(publicOrigin).host.toLowerCase() && !publicPathAllowed(pathname, request.method)) return new NextResponse('Not found', { status: 404 })
  const headers = new Headers(request.headers)
  headers.set('x-pathname', pathname)
  const response = NextResponse.next({ request: { headers } })
  if (pathname.startsWith('/share/kiosk/') || pathname.startsWith('/api/public/kiosks/')) {
    response.headers.set('Cache-Control', 'private, no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
    response.headers.set('X-Content-Type-Options', 'nosniff')
    response.headers.set('X-Frame-Options', 'DENY')
  }
  return response
}
