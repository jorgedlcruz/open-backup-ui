import { z } from 'zod'

export const providers = {
  openai: { name: 'OpenAI', description: 'GPT and reasoning models', endpoint: 'https://api.openai.com/v1/models', defaultModel: 'gpt-4o-mini', docs: 'https://developers.openai.com/api/reference/resources/models/methods/list', models: ['o3-mini', 'o1', 'gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
  gemini: { name: 'Google Gemini', description: 'Gemini text generation', endpoint: 'https://generativelanguage.googleapis.com/v1beta/models', defaultModel: 'gemini-2.5-flash', docs: 'https://ai.google.dev/api/models', models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-pro-exp-02-05', 'gemini-2.0-flash', 'gemini-1.5-pro-latest', 'gemini-1.5-flash-latest'] },
  anthropic: { name: 'Anthropic', description: 'Claude models', endpoint: 'https://api.anthropic.com/v1/models', defaultModel: 'claude-3-7-sonnet-20250219', docs: 'https://platform.claude.com/docs/en/api/models/list', models: ['claude-3-7-sonnet-20250219', 'claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'] },
} as const
export type Provider = keyof typeof providers
export const providerSchema = z.enum(['openai', 'gemini', 'anthropic'])
export const modelId = z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/, 'Enter a valid model ID.').refine(value => !value.split('/').some(part => part === '.' || part === '..'), 'Enter a valid model ID.')
export const configurationInput = z.object({
  provider: providerSchema, modelName: modelId,
  apiKey: z.string().trim().max(4096).refine(value => !/[\s\u0000-\u001f\u007f•]/.test(value), 'Enter an API key without spaces or masked characters.').optional().default(''),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
export type Draft = { provider: Provider; modelName: string; apiKey: string }
export type CredentialSource = 'saved' | 'environment' | 'missing' | 'unreadable' | 'new'
export type Configuration = {
  provider: Provider; modelName: string; hasSavedKey: boolean;
  credentialSource: CredentialSource; environmentProviders: Provider[]; revision: string;
}
export type Model = { id: string; name: string }
export type ConnectionState = 'verified' | 'rejected' | 'forbidden' | 'rate-limited' | 'service-error' | 'unreachable' | 'invalid-response' | 'missing-key' | 'unreadable-key'
export type Check = {
  provider: Provider; modelName: string; connection: ConnectionState; credentialSource: CredentialSource;
  detail: string; checkedAt: string; latencyMs: number; httpStatus: number | null;
  models: Model[]; complete: boolean;
}
export const connectionLabels: Record<ConnectionState, string> = {
  verified: 'Connection verified', rejected: 'Key rejected', forbidden: 'Access denied', 'rate-limited': 'Rate limited',
  'service-error': 'Provider error', unreachable: 'Unreachable', 'invalid-response': 'Unexpected response',
  'missing-key': 'Key required', 'unreadable-key': 'Saved key unreadable',
}
export const credentialLabels: Record<CredentialSource, string> = {
  saved: 'Saved key', environment: 'Server environment', missing: 'Not configured', unreadable: 'Saved key unreadable', new: 'New key · unsaved',
}
export function modelEvidence(check: Check | null, selected: string): 'listed' | 'not-listed' | 'unknown' {
  if (!check || check.connection !== 'verified') return 'unknown'
  if (check.models.some(model => model.id === selected)) return 'listed'
  return check.complete ? 'not-listed' : 'unknown'
}
export function staleCheck(check: Check | null, now = Date.now()) {
  if (!check) return true
  const checked = Date.parse(check.checkedAt)
  return !Number.isFinite(checked) || now - checked > 5 * 60 * 1000 || checked > now + 60000
}
export function modelOptions(provider: Provider, current: string, discovered: Model[] = []): Model[] {
  const options = new Map<string, Model>()
  for (const id of providers[provider].models) options.set(id, { id, name: id })
  for (const model of discovered) options.set(model.id, model)
  if (current && !options.has(current)) options.set(current, { id: current, name: current })
  return [...options.values()].sort((a, b) => a.id.localeCompare(b.id))
}
