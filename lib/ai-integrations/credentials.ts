import type { CredentialSource, Provider } from './model'

export type StoredAi = { provider: string; modelName?: string; apiKey?: string; encryptedApiKey?: string }
export function environmentKey(provider: Provider, env: Record<string, string | undefined>) {
  if (provider === 'openai') return env.OPENAI_API_KEY?.trim() || ''
  if (provider === 'anthropic') return env.ANTHROPIC_API_KEY?.trim() || ''
  return env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim() || ''
}
/** A stored credential belongs only to its saved provider. */
export function resolveCredential(provider: Provider, stored: StoredAi, supplied: string, env: Record<string, string | undefined>): { key: string; source: CredentialSource } {
  if (supplied.trim()) return { key: supplied.trim(), source: 'new' }
  if (stored.provider === provider) {
    if (stored.apiKey) return { key: stored.apiKey, source: 'saved' }
    if (stored.encryptedApiKey) return { key: '', source: 'unreadable' }
  }
  const key = environmentKey(provider, env)
  return { key, source: key ? 'environment' : 'missing' }
}
