// Open Backup UI v1.2.0
/** Bound local settings requests so the form always recovers from a stalled response. */
export async function requestAiConfiguration(path: '' | '/check', signal: AbortSignal, body?: unknown, fetcher: typeof fetch = fetch, timeoutMs = path === '/check' ? 30000 : 15000) {
  const timeout = AbortSignal.timeout(timeoutMs)
  try {
    const response = await fetcher(`/api/settings/ai${path}`, {
      signal: AbortSignal.any([signal, timeout]), cache: 'no-store',
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    })
    const data = await response.json().catch(error => {
      if (timeout.aborted || signal.aborted) throw error
      return null
    })
    if (!response.ok || !data) throw Error(data?.error || 'The AI configuration request could not be completed.')
    return data
  } catch (error) {
    if (timeout.aborted && !signal.aborted) throw Error(path === '/check'
      ? 'The connection check timed out. Please try again.'
      : body ? 'Save confirmation timed out. Your draft is still here; retry or reload to check the saved configuration.'
        : 'Loading AI settings timed out. Please retry.')
    throw error
  }
}
