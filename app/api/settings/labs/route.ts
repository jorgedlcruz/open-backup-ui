import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { LABS_COOKIE } from '@/lib/labs/model'
import { isSameApplicationOrigin, isSecureApplicationRequest } from '@/lib/server/request-origin'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }
export async function GET() {
  return NextResponse.json({ enabled: (await cookies()).get(LABS_COOKIE)?.value === 'true' }, { headers })
}
export async function PUT(request: NextRequest) {
  if (!isSameApplicationOrigin(request) || request.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: 'Change Labs settings from this application.' }, { status: 403, headers })
  }
  let body: unknown
  try { const text = await request.text(); if (text.length > 1000) throw new Error(); body = JSON.parse(text) }
  catch { return NextResponse.json({ error: 'Choose whether Labs is enabled.' }, { status: 400, headers }) }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || typeof (body as { enabled?: unknown }).enabled !== 'boolean') {
    return NextResponse.json({ error: 'Choose whether Labs is enabled.' }, { status: 400, headers })
  }
  const enabled = (body as { enabled: boolean }).enabled
  const response = NextResponse.json({ enabled }, { headers })
  response.cookies.set(LABS_COOKIE, String(enabled), { httpOnly: true, sameSite: 'lax', secure: isSecureApplicationRequest(request), path: '/', maxAge: 31536000 })
  return response
}
