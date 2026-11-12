// Open Backup UI v1.2.0
import { configStore } from './config-store'
import { tokenManager } from './token-manager'
import { sourceBinding, ShareError, type ShareRecord } from './kiosk-shares'
import { loadOperations } from '../operations/load'
import { loadProtectedData } from '../protected-data/load'
import { loadRansomware } from '../ransomware/load'
import { endpoint, toDataset, type RawDataset } from '../labs/data'
import { isCachedSource, type Dataset } from '../labs/model'
import { forecastDataset } from '../labs/forecast-data'
import { readCachedForecastSnapshot } from './forecast-cache'
import { configuredScope } from './capacity-collector'
import { loadProxyInventory } from '../proxies/load'
import { loadServerInventory } from '../managed-servers/load'
import { loadVbr as loadLicensing } from '../licensing/load'
import { prepareWidget, publicWidget } from '../labs/presentation'
import type { PublicKiosk } from '../labs/sharing'
import type { VbrReader } from './vbr-read'

export function shareSource(record: Pick<ShareRecord, 'sourceId' | 'sourceBinding'>) {
  const source = configStore.getById(record.sourceId)
  if (!source || source.platform !== 'vbr' || !source.password || sourceBinding(source) !== record.sourceBinding) throw new ShareError('The published data source is unavailable.', 503)
  return source
}
const cache = new Map<string, { revision: string; until: number; pending: Promise<PublicKiosk> }>()
export function readPublicKiosk(record: ShareRecord): Promise<PublicKiosk> {
  // Check the configured binding even on cache hits. Never read the visitor's source cookies.
  shareSource(record)
  const prior = cache.get(record.id)
  if (prior?.revision === record.revision && prior.until > Date.now()) return prior.pending
  for (const [id, entry] of cache) if (entry.until < Date.now()) cache.delete(id)
  if (cache.size >= 100) throw new ShareError('Shared kiosks are busy. Please retry shortly.', 503)
  const entry = { revision: record.revision, until: Date.now() + 90000, pending: load(record) }
  cache.set(record.id, entry)
  entry.pending.then(() => { entry.until = Date.now() + 30000 }, () => { if (cache.get(record.id) === entry) cache.delete(record.id) })
  return entry.pending
}
async function load(record: ShareRecord): Promise<PublicKiosk> {
  const source = shareSource(record), destination = new URL(`${source.protocol}://${source.host}:${source.port}`)
  if (!['http:', 'https:'].includes(destination.protocol)) throw new ShareError('The published data source is unavailable.', 503)
  let token: string | null | undefined, authentication: ReturnType<typeof tokenManager.getToken> | undefined
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60000)
  try {
    const read: VbrReader = async (path, revision = '1.3-rev1') => {
      shareSource(record)
      const url = new URL(path, destination)
      if (!path.startsWith('/api/v1/') || url.origin !== destination.origin) throw new Error('Unsupported data path')
      if (!token) { authentication ??= tokenManager.getToken(source.id); token = await authentication }
      if (!token) throw new ShareError('The published data source is unavailable.', 503)
      shareSource(record)
      const send = () => fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'x-api-version': revision }, redirect: 'error', cache: 'no-store', signal: controller.signal })
      let response = await send()
      if (response.status === 401) { shareSource(record); token = await tokenManager.refreshToken(source.id); if (token) response = await send() }
      if (!response.ok) throw new Error('Published source could not be read.')
      return response.json()
    }
    const requests = new Map<string, Promise<RawDataset>>()
    const datasets = new Map<string, Promise<Dataset>>()
    const widgets = await Promise.all(record.board.widgets.map(async widget => {
      const key = endpoint(widget.source, widget.range, widget)
      let pending = requests.get(key)
      if (!pending) {
        pending = Promise.resolve().then<RawDataset>(() => {
          if (isCachedSource(widget.source)) return forecastDataset(readCachedForecastSnapshot({ cacheKey: configuredScope(source).scope, serverCredentials: true, sourceId: source.id }), widget.source, widget)
          if (widget.source === 'proxies') return loadProxyInventory(read, '')
          if (widget.source === 'servers') return loadServerInventory(read, '')
          if (widget.source === 'licenses') return loadLicensing(read, '')
          return widget.source === 'protected' || widget.source === 'objects' ? loadProtectedData(read, '') : widget.source === 'malware' ? loadRansomware(read, '') : loadOperations(read, '', widget.range)
        })
        requests.set(key, pending)
      }
      const datasetKey = `${widget.source}:${key}`
      if (!datasets.has(datasetKey)) datasets.set(datasetKey, pending.then(raw => toDataset(widget.source, raw)))
      try { return { widget: publicWidget(widget), presentation: prepareWidget(await datasets.get(datasetKey)!, widget, true) } }
      catch { return { widget: publicWidget(widget), error: 'This widget could not refresh. Try again shortly.' } }
    }))
    return { name: record.board.name, updatedAt: record.updatedAt, refresh: record.board.refresh, gap: record.board.layout.gap, theme: record.theme, mode: record.mode, widgets }
  } finally { clearTimeout(timer); controller.abort() }
}
