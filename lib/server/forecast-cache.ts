// Open Backup UI v1.0.2
import { configStore, type VBRSource } from './config-store'
import { tokenManager } from './token-manager'
import { configuredScope, getCollectorStatus } from './capacity-collector'
import { recordCapacity } from './capacity-history'
import { forecastCache } from '../forecast/cache'
import { loadForecast } from '../forecast/load'
import { TopologyRequestError } from '../topology/load'
import type { VbrReader } from './vbr-read'
import { forecastPreview } from '../lens/forecast-preview'

const backgroundEnabled = () => process.env.CAPACITY_COLLECTOR_ENABLED !== 'false'
const endpoints = new Set([
  '/api/v1/serverInfo', '/api/v1/backupInfrastructure/repositories/states',
  '/api/v1/backupInfrastructure/repositories', '/api/v1/backupInfrastructure/scaleOutRepositories',
  '/api/v1/jobs', '/api/v1/backupObjects', '/api/v1/backups', '/api/v1/restorePoints',
])

/** Only the GET endpoints used by the planning loader; no operations or arbitrary destinations. */
export function planningEndpointAllowed(target: URL, destination: URL) {
  return target.origin === destination.origin && !target.username && !target.password &&
    (endpoints.has(target.pathname) || /^\/api\/v1\/backups\/[^/]+\/(backupFiles|objects)$/.test(target.pathname))
}

function currentSource(id: string, scope: string): VBRSource {
  const current = configStore.getById(id)
  if (!current?.password || current.platform !== 'vbr' || configuredScope(current).scope !== scope) {
    throw new TopologyRequestError('Source configuration changed during collection. This reading was discarded.', 409)
  }
  return current
}

// Called only after a real collection. Cache hits must never create new history measurements.
async function loadSnapshot(read: VbrReader, sourceName: string, scope: string, check: () => void) {
  const snapshot = await loadForecast(read, sourceName)
  check()
  try {
    snapshot.observations = await recordCapacity(scope, snapshot.repositories.data)
    snapshot.historyAvailable = true
  } catch {
    snapshot.warnings.push('Capacity history could not be saved or read. Current API evidence remains available.')
  }
  check()
  return snapshot
}

async function loadSessionForecast(read: VbrReader, sourceName: string, scope: string, signal: AbortSignal) {
  let authorizationFailure: unknown
  const sessionRead: VbrReader = async (...args) => {
    try { return await read(...args) }
    catch (error) {
      if (error instanceof TopologyRequestError && (error.status === 401 || error.status === 403)) authorizationFailure = error
      throw error
    }
  }
  try {
    return await loadSnapshot(sessionRead, sourceName, scope, () => {
      if (signal.aborted) throw new DOMException('Forecast cancelled', 'AbortError')
    })
  } catch (error) { throw authorizationFailure || error }
}

/** Owns its transport lifetime so navigating away cannot abort an unattended refresh. */
export async function loadConfiguredForecast(sourceId: string, scope: string) {
  const source = currentSource(sourceId, scope)
  const { destination } = configuredScope(source)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60000)
  let authorizationFailure: TopologyRequestError | undefined
  const check = () => {
    currentSource(sourceId, scope)
    if (controller.signal.aborted) throw new TopologyRequestError('Loading took too long. Retry or narrow the source environment.', 504)
  }
  try {
    let token = await tokenManager.getToken(sourceId)
    check()
    if (!token) throw new TopologyRequestError('Your VBR session has expired. Reconnect your data source.', 401)
    let renewing: Promise<string | null> | undefined
    const read: VbrReader = async (endpoint, revision = '1.3-rev1') => {
      const target = new URL(endpoint, destination)
      if (!planningEndpointAllowed(target, destination)) throw new TopologyRequestError('Unsupported collector request.', 400)
      const send = () => {
        check()
        return fetch(target, {
          method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'x-api-version': revision },
          cache: 'no-store', redirect: 'error', signal: controller.signal,
        })
      }
      const sentToken = token
      let response = await send()
      if (response.status === 401) {
        // Parallel planning sections share one renewal for the same rejected token.
        if (token === sentToken) {
          renewing ??= tokenManager.refreshToken(sourceId)
          token = await renewing
        }
        if (token) response = await send()
      }
      if (!response.ok) {
        const error = new TopologyRequestError(
          response.status === 401 ? 'Your VBR session has expired. Reconnect your data source.'
            : response.status === 403 ? 'Your VBR account cannot read the required backup records.'
              : 'The VBR platform could not return protection data.',
          response.status === 401 || response.status === 403 ? response.status : 502,
        )
        if (response.status === 401 || response.status === 403) authorizationFailure = error
        throw error
      }
      return response.json()
    }
    return await loadSnapshot(read, source.host, scope, check)
  } catch (error) {
    // The loader can downgrade optional 403s to partial evidence. If the whole
    // collection fails, preserve the auth status so stale privileged data is evicted.
    throw authorizationFailure || error
  } finally {
    clearTimeout(timeout)
    controller.abort()
  }
}

export function readForecastPreview(context: { cacheKey: string; serverCredentials: boolean; sourceId?: string }) {
  return { preview: forecastPreview(readCachedForecastSnapshot(context)) }
}

export function readCachedForecastSnapshot(context: { cacheKey: string; serverCredentials: boolean; sourceId?: string }) {
  const configured = context.serverCredentials && !!context.sourceId
  if (configured) currentSource(context.sourceId!, context.cacheKey)
  return forecastCache.peek(context.cacheKey, configured && backgroundEnabled())
}

export async function readForecastSnapshot(
  read: VbrReader, sourceName: string,
  context: { cacheKey: string; serverCredentials: boolean; sourceId?: string },
  options: { force: boolean; signal: AbortSignal },
) {
  const configured = context.serverCredentials && !!context.sourceId
  if (configured) currentSource(context.sourceId!, context.cacheKey)
  const snapshot = await forecastCache.read(context.cacheKey,
    configured ? () => loadConfiguredForecast(context.sourceId!, context.cacheKey)
      : () => loadSessionForecast(read, sourceName, context.cacheKey, options.signal),
    { force: options.force, background: configured && backgroundEnabled(), signal: options.signal },
  )
  if (configured) currentSource(context.sourceId!, context.cacheKey)
  return { ...snapshot, collector: await getCollectorStatus(context.cacheKey, context.serverCredentials) }
}

type Runtime = { timer?: ReturnType<typeof setInterval>; busy: boolean; scopes: Map<string, string> }
const globalRefresh = globalThis as typeof globalThis & { forecastRefreshRuntime?: Runtime }

export function startForecastRefresh() {
  if (!backgroundEnabled() || process.env.NEXT_PHASE === 'phase-production-build') return
  const runtime: Runtime = globalRefresh.forecastRefreshRuntime ??= { busy: false, scopes: new Map() }
  if (runtime.timer) return
  const tick = async () => {
    if (runtime.busy || !backgroundEnabled()) return
    runtime.busy = true
    try {
      const ids = new Set(configStore.getAll().filter(source => source.platform === 'vbr').map(source => source.id))
      if (configStore.getById('env-vbr')?.password) ids.add('env-vbr')
      const sources: Array<{ id: string; scope: string }> = []
      for (const id of ids) {
        try {
          const source = configStore.getById(id)
          if (!source?.password || source.platform !== 'vbr') continue
          const { scope } = configuredScope(source)
          sources.push({ id, scope })
        } catch { /* One invalid source must not block refreshes for the others. */ }
      }
      for (const [id, scope] of runtime.scopes) {
        if (!sources.some(source => source.id === id && source.scope === scope)) forecastCache.delete(scope)
      }
      runtime.scopes = new Map(sources.map(source => [source.id, source.scope]))
      let cursor = 0
      await Promise.all(Array.from({ length: Math.min(2, sources.length) }, async () => {
        while (cursor < sources.length) {
          const { id, scope } = sources[cursor++]
          if (!forecastCache.due(scope)) continue
          try {
            await forecastCache.read(scope, () => loadConfiguredForecast(id, scope), { force: true, background: true })
          } catch { /* Cache retains failure state and the last usable snapshot for the next attempt. */ }
        }
      }))
    } catch { /* A later tick retries configuration access; request errors remain visible to the caller. */ }
    finally { runtime.busy = false }
  }
  runtime.timer = setInterval(() => void tick(), 60000)
  runtime.timer.unref()
  void tick()
}
