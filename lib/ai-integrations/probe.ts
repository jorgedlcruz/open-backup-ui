import { providers, modelId, type Check, type CredentialSource, type Model, type Provider } from './model'

type Reply = Pick<Response, 'ok' | 'status' | 'json'>
type Request = (url: string, headers: Record<string, string>) => Promise<Reply>
const text = (value: unknown) => typeof value === 'string' ? value : ''
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** Metadata-only check: no prompt, backup context, or inference request. */
export async function probeProvider(provider: Provider, selectedModel: string, key: string, source: CredentialSource, request: Request): Promise<Check> {
  const start = Date.now()
  const result: Check = { provider, modelName: selectedModel, connection: 'missing-key', credentialSource: source, detail: 'Add a key for this provider before checking the connection.', checkedAt: new Date().toISOString(), latencyMs: 0, httpStatus: null, models: [], complete: false }
  if (!key) return { ...result, connection: source === 'unreadable' ? 'unreadable-key' : 'missing-key', detail: source === 'unreadable' ? 'The saved key could not be decrypted on this server. Enter a replacement key.' : result.detail }
  const headers: Record<string, string> = provider === 'openai' ? { Authorization: `Bearer ${key}` } : provider === 'gemini' ? { 'x-goog-api-key': key } : { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
  const models = new Map<string, Model>(), seen = new Set<string>()
  let cursor = ''
  try {
    for (let page = 0; page < 10; page++) {
      const url = new URL(providers[provider].endpoint)
      if (provider === 'gemini') { url.searchParams.set('pageSize', '1000'); if (cursor) url.searchParams.set('pageToken', cursor) }
      if (provider === 'anthropic') { url.searchParams.set('limit', '100'); if (cursor) url.searchParams.set('after_id', cursor) }
      result.httpStatus = null
      const response = await request(url.toString(), headers)
      result.httpStatus = response.status
      if (!response.ok) {
        result.connection = response.status === 401 ? 'rejected' : response.status === 403 ? 'forbidden' : response.status === 429 ? 'rate-limited' : 'service-error'
        result.detail = response.status === 401 ? 'The provider rejected this key. Check or replace the credential.' : response.status === 403 ? 'The provider denied access to its model catalog. Check key permissions and account restrictions.' : response.status === 429 ? 'The provider rate-limited the check. Retry later and review account limits.' : 'The provider could not complete the model-catalog request. Retry later.'
        break
      }
      const body = record(await response.json())
      if (provider === 'anthropic' && typeof body.has_more !== 'boolean') throw Error('Invalid pagination')
      if (provider === 'gemini' && body.nextPageToken !== undefined && typeof body.nextPageToken !== 'string') throw Error('Invalid pagination')
      const items = provider === 'gemini' ? body.models : body.data
      // Gemini can omit its repeated models field for an empty catalog.
      if (!Array.isArray(items) && !(provider === 'gemini' && body.models === undefined && Object.keys(body).every(key => key === 'nextPageToken'))) throw Error('Invalid catalog')
      for (const entry of (items || []) as unknown[]) {
        const item = record(entry)
        if (provider === 'gemini' && !(Array.isArray(item.supportedGenerationMethods) && item.supportedGenerationMethods.includes('generateContent'))) continue
        const id = provider === 'gemini' ? text(item.name).replace(/^models\//, '') : text(item.id)
        if (!modelId.safeParse(id).success) throw Error('Invalid model')
        // API response text is data, never instructions or HTML.
        const name = text(provider === 'gemini' ? item.displayName : item.display_name).slice(0, 200) || id
        models.set(id, { id, name })
      }
      result.connection = 'verified'
      result.detail = 'The provider accepted the key and returned its model catalog. Generation, billing, and model compatibility have not been tested.'
      const next = provider === 'gemini' ? text(body.nextPageToken) : provider === 'anthropic' && body.has_more === true ? text(body.last_id) : ''
      if (provider === 'anthropic' && body.has_more === true && !next) break
      if (!next) { result.complete = true; break }
      if (seen.has(next)) break
      seen.add(next); cursor = next
    }
  } catch {
    result.connection = result.httpStatus !== null && result.httpStatus >= 200 && result.httpStatus < 300 ? 'invalid-response' : 'unreachable'
    result.detail = result.connection === 'invalid-response' ? 'The model catalog was incomplete or unreadable. Retry the check.' : 'The provider could not be reached before the check completed. Check connectivity and retry.'
  }
  result.models = [...models.values()].sort((a, b) => a.id.localeCompare(b.id))
  if (result.connection === 'verified' && !result.complete) result.detail += ' The model list is partial; absence does not establish model availability.'
  result.checkedAt = new Date().toISOString(); result.latencyMs = Date.now() - start
  return result
}
