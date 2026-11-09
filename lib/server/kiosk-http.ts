// Open Backup UI v1.0.2
import { NextRequest, NextResponse } from 'next/server'
import { configStore } from './config-store'
import { applicationOrigin, isSecureApplicationRequest } from './request-origin'
import { configuredPublicOrigin, type SharedLink } from '../labs/sharing'
import { ShareError, validToken, type ShareRecord } from './kiosk-shares'

export const OWNER_COOKIE = 'kiosk-share-owner'
export const ACCESS_COOKIE = 'kiosk-view-access'
export const privateHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'X-Content-Type-Options': 'nosniff' }
export function json(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: privateHeaders }) }
export function failure(error: unknown) { return json({ error: error instanceof ShareError ? error.message : 'Sharing is unavailable. Please retry.' }, error instanceof ShareError ? error.status : 503) }
export function sameOrigin(request: NextRequest) {
  if (request.headers.get('origin') !== applicationOrigin(request) || request.headers.get('sec-fetch-site') === 'cross-site') throw new ShareError('Use the application to make this request.', 403)
}
export function managedSource(request: NextRequest) {
  const publicOrigin = configuredPublicOrigin(process.env.KIOSK_PUBLIC_ORIGIN)
  if (!publicOrigin) throw new ShareError('Configure a separate kiosk URL before sharing.', 409)
  if (publicOrigin && new URL(applicationOrigin(request)).host === new URL(publicOrigin).host) throw new ShareError('Not found.', 404)
  const id = request.cookies.get('veeam_source_id')?.value
  const source = id ? configStore.getById(id) : undefined
  if (!source || source.platform !== 'vbr' || !source.password) throw new ShareError('Select a saved VBR connection before sharing.', 400)
  return source
}
export function ownerCookie(request: NextRequest) {
  const owner = request.cookies.get(OWNER_COOKIE)?.value ?? ''
  return validToken(owner) ? owner : null
}
export function cookieOptions(request: NextRequest, path = '/api/labs/shares', maxAge = 31536000) {
  return { httpOnly: true, secure: isSecureApplicationRequest(request), sameSite: 'strict' as const, path, maxAge }
}
export function linkInfo(record: ShareRecord, request: NextRequest): SharedLink {
  return { id: record.id, name: record.board.name, protected: !!record.password, updatedAt: record.updatedAt, url: `${configuredPublicOrigin(process.env.KIOSK_PUBLIC_ORIGIN) ?? applicationOrigin(request)}/share/kiosk/${record.id}` }
}
export async function readBody(request: NextRequest, max = 500000) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ShareError('Use a JSON request.', 415)
  if (Number(request.headers.get('content-length')) > max) throw new ShareError('Request is too large.', 413)
  const reader = request.body?.getReader()
  if (!reader) throw new ShareError('Request body is required.')
  const chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > max) { await reader.cancel(); throw new ShareError('Request is too large.', 413) } chunks.push(value) }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new ShareError('Invalid JSON request.') }
  } finally { reader.releaseLock() }
}
