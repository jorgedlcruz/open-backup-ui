import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { settingsStore } from './settings-store'
import { configurationInput, providerSchema, providers, type Configuration, type Provider } from '../ai-integrations/model'
import { environmentKey, resolveCredential, type StoredAi } from '../ai-integrations/credentials'
import { probeProvider } from '../ai-integrations/probe'

const headers = { 'Cache-Control': 'private, no-store' }
class ConfigurationError extends Error { constructor(message: string, public status = 400) { super(message) } }
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof ConfigurationError ? error.message : 'AI configuration could not be read or updated. Check the server settings file and try again.' }, { status: error instanceof ConfigurationError ? error.status : 500, headers })
}
function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin')
  if (origin && origin !== request.nextUrl.origin) throw new ConfigurationError('AI settings requests must originate from this application.', 403)
}
export function configurationRevision(settings: StoredAi) {
  // A one-way revision binds evidence and edits to credentials without disclosing them.
  return createHash('sha256').update(JSON.stringify([settings.provider, settings.modelName, settings.encryptedApiKey, settings.apiKey, ...Object.keys(providers).map(provider => environmentKey(provider as Provider, process.env))])).digest('hex')
}
export function publicConfiguration(settings: StoredAi): Configuration {
  const parsed = providerSchema.safeParse(settings.provider)
  if (!parsed.success) throw new ConfigurationError('This saved provider is unsupported. Select OpenAI, Google Gemini, or Anthropic in the server configuration.', 422)
  const provider = parsed.data
  return { provider, modelName: settings.modelName || providers[provider].defaultModel, hasSavedKey: !!settings.encryptedApiKey || !!settings.apiKey, credentialSource: resolveCredential(provider, settings, '', process.env).source, environmentProviders: (Object.keys(providers) as Provider[]).filter(provider => !!environmentKey(provider, process.env)), revision: configurationRevision(settings) }
}
export async function readConfiguration() {
  try { return NextResponse.json(publicConfiguration(settingsStore.get().ai), { headers }) } catch (error) { return failure(error) }
}
export async function updateConfiguration(request: NextRequest, action: 'save' | 'check') {
  try {
    sameOrigin(request)
    const parsed = configurationInput.safeParse(await request.json().catch(() => null))
    if (!parsed.success) throw new ConfigurationError('Select a provider, enter a valid model ID, and use an unmasked API key. Refresh if the configuration is out of date.')
    const input = parsed.data, current = settingsStore.get().ai
    if (input.revision !== configurationRevision(current)) throw new ConfigurationError('Configuration changed on the server. Reload it before saving or checking again.', 409)
    if (action === 'save') {
      settingsStore.save({ ai: { provider: input.provider, modelName: input.modelName, apiKey: input.apiKey } })
      return NextResponse.json(publicConfiguration(settingsStore.get().ai), { headers })
    }
    const credential = resolveCredential(input.provider, current, input.apiKey, process.env)
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20000)])
    const check = await probeProvider(input.provider, input.modelName, credential.key, credential.source, (url, auth) => fetch(url, { method: 'GET', headers: { Accept: 'application/json', ...auth }, signal, cache: 'no-store', redirect: 'error' }))
    if (configurationRevision(settingsStore.get().ai) !== input.revision) throw new ConfigurationError('Configuration changed while the check was running. Reload and check again.', 409)
    return NextResponse.json(check, { headers })
  } catch (error) { return failure(error) }
}
