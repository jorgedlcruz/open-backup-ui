// Open Backup UI v1.3.0

import { get } from 'node:https'
import type { IncomingHttpHeaders } from 'node:http'
import { parseRelease, releaseState, type Release, type UpdateStatus } from './releases'

const endpoint = 'https://api.github.com/repos/jorgedlcruz/open-backup-ui/releases/latest'
const hour = 60 * 60_000
const errorBackoff = 5 * 60_000
const maxBytes = 1024 * 1024

type Response = { status: number; headers: IncomingHttpHeaders; text: string }

function requestRelease(etag?: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    // The Veeam connector may allow self-signed certificates. Public GitHub must always verify TLS.
    const request = get(endpoint, {
      rejectUnauthorized: true,
      agent: false,
      signal: AbortSignal.timeout(8000),
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Open-Backup-UI-release-check',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(etag ? { 'If-None-Match': etag } : {}),
      },
    }, response => {
      const chunks: Buffer[] = []
      let size = 0
      response.on('error', reject)
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > maxBytes) response.destroy(new Error('Release response too large'))
        else chunks.push(chunk)
      })
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }))
    })
    request.on('error', reject)
  })
}

function retryTime(headers: IncomingHttpHeaders, now: number) {
  const retry = headers['retry-after']
  const retryAt = typeof retry === 'string' && !/^\d+$/.test(retry) ? Date.parse(retry) : now + Number(retry ?? 0) * 1000
  const resetAt = Number(headers['x-ratelimit-reset'] ?? 0) * 1000
  return Math.max(now + errorBackoff, Number.isFinite(retryAt) ? retryAt : 0, Number.isFinite(resetAt) ? resetAt : 0)
}

export function createReleaseReader(fetchRelease = requestRelease, now = Date.now) {
  let release: Release | null = null
  let etag: string | undefined
  let unavailable = false
  let nextCheck = 0
  let pending: Promise<void> | undefined
  async function refresh() {
    try {
      const response = await fetchRelease(etag)
      if (response.status === 200) {
        release = parseRelease(JSON.parse(response.text))
        etag = response.headers.etag
      } else if (response.status === 404) {
        release = null
        etag = undefined
      } else if (response.status !== 304 || !etag) {
        unavailable = true
        nextCheck = retryTime(response.headers, now())
        return
      }
      unavailable = false
      nextCheck = now() + hour
    } catch {
      unavailable = true
      nextCheck = now() + errorBackoff
    }
  }
  return async (installed: string): Promise<UpdateStatus> => {
    if (now() >= nextCheck) {
      pending ??= refresh().finally(() => { pending = undefined })
      await pending
    }
    return { installed, state: unavailable ? 'unavailable' : release ? releaseState(installed, release.tag) : 'empty', release }
  }
}

export const readRelease = createReleaseReader()
