import type { Provider } from '../ai-integrations/model'
import { EMPTY_SUMMARY, HEALTH_STREAM_TYPE, INTERRUPTED_SUMMARY, type HealthSummaryEvent, type HealthSummaryProblem } from '../ai-integrations/health-stream'
import { healthSummaryProblem } from './health-summary-errors'

type ProviderPart = { type: string; text?: string; error?: unknown; finishReason?: string }

async function* summaryEvents(parts: AsyncIterable<ProviderPart>, provider: Provider, apiKey: string, signal?: AbortSignal): AsyncGenerator<HealthSummaryEvent> {
  let hasText = false, finished = false
  try {
    for await (const part of parts) {
      if (signal?.aborted) return
      if (part.type === 'text-delta' && part.text) {
        hasText ||= !!part.text.trim()
        yield { type: 'text', text: part.text }
      } else if (part.type === 'error') {
        yield { type: 'error', problem: healthSummaryProblem(part.error, provider, apiKey) }; return
      } else if (part.type === 'abort') {
        yield { type: 'error', problem: { provider, kind: 'interrupted', message: INTERRUPTED_SUMMARY } }; return
      } else if (part.type === 'finish') {
        if (part.finishReason === 'error') { yield { type: 'error', problem: healthSummaryProblem(undefined, provider) }; return }
        finished = true
      }
    }
    if (signal?.aborted) return
    if (!finished) yield { type: 'error', problem: { provider, kind: 'interrupted', message: INTERRUPTED_SUMMARY } }
    else if (!hasText) yield { type: 'error', problem: { provider, kind: 'empty', message: EMPTY_SUMMARY } }
    else yield { type: 'finish' }
  } catch (error) {
    if (!signal?.aborted) yield { type: 'error', problem: healthSummaryProblem(error, provider, apiKey) }
  }
}

const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
function failure(problem: HealthSummaryProblem) {
  return Response.json({ error: problem.message, problem }, { status: problem.status || 502, headers })
}

export async function healthSummaryResponse(parts: AsyncIterable<ProviderPart>, provider: Provider, apiKey: string, framed: boolean, signal?: AbortSignal): Promise<Response> {
  const events = summaryEvents(parts, provider, apiKey, signal)
  // Older open tabs expect plain text. Buffer their response so a provider
  // failure still arrives as an HTTP error instead of looking like a blank report.
  if (!framed) {
    let output = ''
    for await (const event of events) {
      if (event.type === 'error') return failure(event.problem)
      if (event.type === 'text') output += event.text
    }
    return new Response(output, { headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } })
  }
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await events.next()
      if (done) controller.close()
      else controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`))
    },
    async cancel() { await events.return(undefined) },
  })
  return new Response(stream, { headers: { ...headers, 'Content-Type': `${HEALTH_STREAM_TYPE}; charset=utf-8` } })
}
