// Open Backup UI v1.0.2
import type { Provider } from '../ai-integrations/model'
import type { HealthSummaryProblem } from '../ai-integrations/health-stream'

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''

/** Only provider diagnostics cross the boundary, never SDK request bodies, headers or stacks. */
export function healthSummaryProblem(error: unknown, provider?: Provider, apiKey = ''): HealthSummaryProblem {
  let current = object(error)
  const seen = new Set<unknown>()
  for (let depth = 0; depth < 6 && !seen.has(current); depth++) {
    seen.add(current)
    const status = typeof current.statusCode === 'number' && Number.isInteger(current.statusCode) && current.statusCode >= 400 && current.statusCode <= 599 ? current.statusCode : undefined
    // OpenAI and Anthropic can report a typed error inside an otherwise-200
    // stream. Preserve that diagnostic without inventing an HTTP status.
    const streamDiagnostic = !(current instanceof Error) && typeof current.type === 'string' && typeof current.message === 'string'
    if (status || streamDiagnostic) {
      let body: Record<string, unknown> = {}
      const raw = text(current.responseBody)
      if (raw && raw.length <= 65536) { try { body = object(JSON.parse(raw)) } catch { /* Non-JSON errors use the SDK's message. */ } }
      const diagnostic = object(body.error)
      let message = text(diagnostic.message) || text(body.message) || text(current.message) || 'Failed to generate AI summary'
      // Redact before truncation so a long credential cannot be partially exposed.
      for (const secret of [apiKey, encodeURIComponent(apiKey)].filter(Boolean)) message = message.split(secret).join('[redacted]')
      message = message.replace(/(\b(?:authorization|x-goog-api-key|x-api-key|api[_ -]?key)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;"'<>]+/gi, '$1[redacted]')
        .replace(/([?&](?:key|api_key|apikey|access_token)=)[^&\s"'<>]+/gi, '$1[redacted]')
        .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
        .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1600)
      const billing = status === 402 || /insufficient_quota|prepayment|credits? (?:are |is )?(?:depleted|exhausted)|credit balance/i.test(message)
      return { provider, status, message: message || 'Failed to generate AI summary', kind: billing ? 'billing' : 'provider' }
    }
    const next = current.lastError ?? (Array.isArray(current.errors) ? current.errors.at(-1) : undefined) ?? current.cause
    if (!next) break
    current = object(next)
  }
  return { provider, message: 'Failed to generate AI summary', kind: 'provider' }
}
