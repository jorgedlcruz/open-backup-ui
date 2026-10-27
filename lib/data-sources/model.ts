import { z } from 'zod'

export const platformSchema = z.enum(['vbr', 'vb365', 'vro', 'one', 'kasten'])
export type Platform = z.infer<typeof platformSchema>
export const platforms: Record<Platform, { name: string; port: number; api: string | null; home: string }> = {
  vbr: { name: 'Veeam Backup & Replication', port: 9419, api: '1.3-rev2', home: '/vbr/lens' },
  vb365: { name: 'Microsoft 365', port: 4443, api: 'v8', home: '/vbm/dashboard' },
  vro: { name: 'Recovery Orchestrator', port: 9081, api: 'v7.21', home: '/vro' },
  one: { name: 'Veeam ONE', port: 1239, api: 'v2.3', home: '/analytics/alarms' },
  kasten: { name: 'Kasten K10', port: 443, api: null, home: '/k10' },
}
export const normalizePlatform = (value: string) => platformSchema.parse(value === 'veeam-one' ? 'one' : value)
export const sourceId = z.string().min(1).max(240).regex(/^[a-zA-Z0-9_.:\[\]-]+$/)
export function endpoint(value: string) {
  const url = new URL(value.trim())
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw Error('Use an HTTP or HTTPS server URL with a port and no path, credentials or query string.')
  return { url: url.origin, host: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)), protocol: url.protocol.slice(0, -1) }
}
const endpointSchema=z.string().min(1).max(2048).transform((value,ctx)=>{try{return endpoint(value)}catch{ctx.addIssue({code:'custom',message:'Enter a server URL without credentials, path or query parameters.'});return z.NEVER}})
export const sourceInput = z.object({ type: platformSchema, name: z.string().trim().max(200), url: endpointSchema }).strict()
export const editInput = sourceInput.omit({ type: true })
export const connectInput = z.object({ username: z.string().trim().min(1).max(512).optional(), password: z.string().min(1).max(4096).optional() }).strict().refine(value => !!value.username === !!value.password)
export type Source = { id: string; type: Platform; name: string; url: string; username: string; hasCredentials: boolean; managed: 'saved' | 'environment'; selected: boolean }
export type Health = {
  connection: 'reachable' | 'unreachable' | 'unknown' | 'unchecked';
  authentication: 'verified' | 'required' | 'rejected' | 'forbidden' | 'unknown';
  api: 'verified' | 'unsupported' | 'unknown' | 'unchecked';
  checkedAt: string | null; latencyMs: number | null; httpStatus: number | null;
  apiVersion: string | null; expectedApi: string | null; productVersion: string | null;
  serverName: string | null; serverPlatform: string | null; tokenExpiresAt: string | null;
  lastAuthenticated: string | null; probePath: string | null; detail: string;
}
export type Row = Source & { health: Health }
export type Snapshot = { sources: Row[]; fetchedAt: string }
export function unchecked(type: Platform): Health {
  return { connection: 'unchecked', authentication: 'unknown', api: 'unchecked', checkedAt: null, latencyMs: null, httpStatus: null, apiVersion: null, expectedApi: platforms[type].api, productVersion: null, serverName: null, serverPlatform: null, tokenExpiresAt: null, lastAuthenticated: null, probePath: null, detail: 'Run a connection check to verify API access.' }
}
export const connectionLabels = { reachable: 'Reachable', unreachable: 'Unreachable', unknown: 'Unknown', unchecked: 'Not checked' }
export const authLabels = { verified: 'Verified API access', required: 'Sign-in required', rejected: 'Authentication rejected', forbidden: 'Permission denied', unknown: 'Not verified' }
export const issues = [['all','All sources'],['attention','Needs attention'],['connection','Connection issues'],['authentication','Authentication / access'],['api','API compatibility'],['credentials','No saved credentials'],['unselected','Not selected'],['unknown','Unknown / not checked']] as const
export type Issue = typeof issues[number][0]
export function stale(row: Row, now = Date.now()) { const time = Date.parse(row.health.checkedAt || ''); return !Number.isFinite(time) || now - time > 300000 || time > now + 60000 }
export function matches(row: Row, issue: Issue, now = Date.now()): boolean {
  const h = row.health
  switch (issue) {
    case 'all': return true
    case 'attention': return matches(row,'connection',now) || matches(row,'authentication',now) || matches(row,'api',now) || matches(row,'unknown',now)
    case 'connection': return h.connection === 'unreachable' || (h.httpStatus !== null && h.httpStatus >= 500)
    case 'authentication': return ['required','rejected','forbidden'].includes(h.authentication)
    case 'api': return h.api === 'unsupported'
    case 'credentials': return !row.hasCredentials
    case 'unselected': return !row.selected
    case 'unknown': return stale(row,now) || h.connection === 'unknown' || h.authentication === 'unknown' || ['unknown','unchecked'].includes(h.api)
  }
}
export type Filters = { query: string; platform: string; issue: Issue; managed: string; sort: 'name' | 'issues' | 'latency' }
export const emptyFilters: Filters = { query:'', platform:'all', issue:'all', managed:'all', sort:'name' }
export function filterRows(rows: Row[], filters: Filters, now = Date.now()) {
  return rows.filter(row => matches(row,filters.issue,now) && (filters.platform === 'all' || row.type === filters.platform) && (filters.managed === 'all' || row.managed === filters.managed) && [row.name,row.url,row.id,row.username,platforms[row.type].name,row.health.serverName,row.health.productVersion,row.health.apiVersion].join(' ').toLowerCase().includes(filters.query.trim().toLowerCase()))
    .sort((a,b) => (filters.sort === 'issues' ? Number(matches(b,'attention',now))-Number(matches(a,'attention',now)) : filters.sort === 'latency' ? (b.health.latencyMs ?? -1)-(a.health.latencyMs ?? -1) : 0) || a.name.localeCompare(b.name))
}
