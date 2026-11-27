'use client'
// Open Backup UI v1.3.0

import { useEffect, useState } from 'react'
import { applicationRequest } from '@/lib/api/application-request'
import { APP_VERSION } from '@/lib/version'
import type { UpdateStatus } from '@/lib/updates/releases'

type Summary = Omit<UpdateStatus, 'release'> & { release: { tag: string } | null }

export function useReleaseStatus(details: true): UpdateStatus | null
export function useReleaseStatus(details: false): Summary | null
export function useReleaseStatus(details: boolean): Summary | null {
  const [status, setStatus] = useState<Summary | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    let nextCheck = 0
    async function check() {
      if (document.hidden || pending || Date.now() < nextCheck) return
      pending = true
      try {
        const result = await applicationRequest<Summary>(details ? '/api/updates?notes=1' : '/api/updates', { signal: controller.signal })
        if (!controller.signal.aborted) setStatus(result)
        nextCheck = Date.now() + (result.state === 'unavailable' ? 5 : 60) * 60_000
      } catch {
        if (!controller.signal.aborted) setStatus(previous => ({ installed: APP_VERSION, state: 'unavailable', release: previous?.release ?? null }))
        nextCheck = Date.now() + 5 * 60_000
      } finally { pending = false }
    }
    void check()
    const timer = window.setInterval(check, 5 * 60_000)
    document.addEventListener('visibilitychange', check)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [details])
  return status
}
