import { z } from 'zod'
import { providerSchema } from './model'

export const HEALTH_STREAM_TYPE = 'application/x-ndjson'
export const EMPTY_SUMMARY = 'The provider returned no summary text. Check AI Integrations and try again.'
export const INTERRUPTED_SUMMARY = 'The AI response was interrupted. Retry to generate a complete summary.'
export const problemSchema = z.object({
  provider: providerSchema.optional(), status: z.number().int().min(400).max(599).optional(),
  message: z.string().min(1).max(1600), kind: z.enum(['provider', 'billing', 'empty', 'interrupted']),
})
export type HealthSummaryProblem = z.infer<typeof problemSchema>
export type HealthSummaryEvent = { type: 'text'; text: string } | { type: 'error'; problem: HealthSummaryProblem } | { type: 'finish' }
export class HealthSummaryError extends Error {
  constructor(public problem: HealthSummaryProblem) { super(problem.message); this.name = 'HealthSummaryError' }
}

/** Read framed errors separately from generated Markdown, including mid-stream failures. */
export async function readHealthSummaryResponse(response: Response, onText: (text: string) => void) {
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    const problem = problemSchema.safeParse(data?.problem)
    if (problem.success) throw new HealthSummaryError(problem.data)
    throw new Error(typeof data?.error === 'string' ? data.error.slice(0, 1600) : 'Failed to generate AI summary')
  }
  if (!response.body) throw new Error('No readable stream returned by API')
  const framed = response.headers.get('content-type')?.includes(HEALTH_STREAM_TYPE)
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = '', finished = false, hasText = false
  const interrupted = () => new HealthSummaryError({ kind: 'interrupted', message: INTERRUPTED_SUMMARY })
  const accept = (line: string) => {
    if (!line.trim()) return
    if (finished) throw interrupted()
    let event
    try { event = JSON.parse(line) } catch { throw interrupted() }
    if (event?.type === 'text' && typeof event.text === 'string') {
      hasText ||= !!event.text.trim(); onText(event.text)
    } else if (event?.type === 'error') {
      const problem = problemSchema.safeParse(event.problem)
      if (!problem.success) throw interrupted()
      throw new HealthSummaryError(problem.data)
    } else if (event?.type === 'finish') finished = true
    else throw interrupted()
  }
  const consume = (text: string) => {
    if (!framed) { hasText ||= !!text.trim(); onText(text); return }
    buffer += text
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); accept(line)
    }
    if (buffer.length > 1024 * 1024) throw interrupted()
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      consume(decoder.decode(value, { stream: true }))
    }
    consume(decoder.decode())
    if (framed) { if (buffer.trim()) accept(buffer); if (!finished) throw interrupted() }
    if (!hasText) throw new HealthSummaryError({ kind: 'empty', message: EMPTY_SUMMARY })
  } catch (error) {
    await reader.cancel().catch(() => {})
    if (error instanceof HealthSummaryError) throw error
    throw interrupted()
  } finally { reader.releaseLock() }
}
