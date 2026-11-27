// Open Backup UI v1.3.0
import type { RecoveryPage } from '../../lib/vbm-recovery/model'

export type BrowsePage = RecoveryPage & { readError?: Error }

function blocksPartialResults(reason: unknown) {
  if (!reason || typeof reason !== 'object') return false
  return ('name' in reason && reason.name === 'AbortError') ||
    ('status' in reason && [401, 403, 409, 499].includes(Number(reason.status)))
}

/** Preserve usable sibling results while retrying a failed combined page at its original offset. */
export async function combineReadPages(reads: Promise<RecoveryPage>[], offset: number): Promise<BrowsePage> {
  const results = await Promise.allSettled(reads)
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  const blockingFailure = failures.find(result => blocksPartialResults(result.reason))
  if (blockingFailure) throw blockingFailure.reason

  const pages = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  if (failures.length && !pages.length) throw failures[0].reason

  const seen = new Set<string>()
  const items = pages.flatMap(page => page.items).filter(item => {
    const key = JSON.stringify([item.ownerId, item.channelId, item.kind, item.id])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const reason: unknown = failures[0]?.reason
  const readError = failures.length
    ? reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'Recovery information could not be loaded.')
    : undefined

  return {
    ...pages[0],
    items,
    offset,
    nextOffset: readError ? offset : Math.max(offset, ...pages.map(page => page.nextOffset)),
    hasMore: !readError && pages.some(page => page.hasMore),
    ...(readError ? { readError } : {}),
  }
}
