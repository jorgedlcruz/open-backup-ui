// Open Backup UI v1.3.0
import { type Health, type Platform, unchecked } from './model'
import { canUseVbrRevision, isVbr13ServerInfo, isVbrVersionRejection, vbrRevisions } from '../vbr/version-response'

export const probes: Record<Platform, {path:string;version:string} | null> = {
  vbr: {path:'/api/v1/serverInfo',version:vbrRevisions[0]}, vb365: {path:'/v8/ServiceInstance',version:'v8'},
  one: {path:'/api/v2.3/vbr/backupServers?Limit=1',version:'v2.3'}, vro: {path:'/api/v7.21/Plans',version:'v7.21'}, kasten: null,
}
const field = (value: unknown): string | null => typeof value === 'string' && value.trim() && value.length <= 200 ? value.trim() : null
type Reply = { status: number; json: () => Promise<unknown> }
type Reader = (path: string, revision: string, authenticated: boolean) => Promise<Reply>
export async function probe(type: Platform, read: Reader, hasToken: boolean, now = () => Date.now()): Promise<Health> {
  const health = unchecked(type), spec = probes[type], start = now()
  health.checkedAt = new Date(start).toISOString()
  if (!spec) { health.detail = 'Live API checks are not implemented for this connector. Connection actions remain available.'; return health }
  health.probePath = spec.path
  try {
    let revision=spec.version, response:Reply|undefined, raw:unknown, unsupported=false
    for (const candidate of type === 'vbr' ? vbrRevisions : [spec.version]) {
      revision=candidate
      response=await read(spec.path,candidate,hasToken)
      health.connection='reachable'
      health.httpStatus=response.status
      if (type !== 'vbr') break
      unsupported=false
      if (response.status >= 200 && response.status < 300) {
        raw=await response.json()
        if (isVbr13ServerInfo(raw) && !canUseVbrRevision(candidate,raw)) continue
      } else if ([400,406,501].includes(response.status)) {
        unsupported=isVbrVersionRejection(response.status,await response.json().catch(()=>null))
        if (unsupported) continue
      }
      break
    }
    // The revision table contains every public v13 contract we support.
    if (!response) throw Error('No API check was made.')
    health.connection='reachable'; health.httpStatus=response.status; health.latencyMs=Math.max(0,now()-start)
    if (response.status === 401) { health.authentication=hasToken ? 'rejected':'required'; health.detail=hasToken ? 'The API rejected the current token. Reconnect this source.':'The API is reachable and requires authentication.'; return health }
    if (response.status === 403) { health.authentication='forbidden'; health.detail='The API denied access to the check resource. Review account permissions.'; return health }
    if (unsupported || [404,405,410].includes(response.status) || (type!=='vbr' && [400,406].includes(response.status))) { health.api='unsupported'; health.detail='The configured API check is unavailable or rejected. Review the endpoint and API compatibility.'; return health }
    if (response.status < 200 || response.status >= 300) { health.api='unknown'; health.detail=`The source returned HTTP ${response.status}. It is reachable, but API access could not be verified.`; return health }
    if (type !== 'vbr') raw=await response.json()
    const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string,unknown> : null
    // A login HTML page or unrelated JSON must not become a healthy API result.
    const valid = type === 'vbr' ? canUseVbrRevision(revision,data) : type === 'vb365' ? !!data && !!field(data.version) : type === 'one' ? !!data && Array.isArray(data.items) : Array.isArray(raw) || !!data && (Array.isArray(data.results) || Array.isArray(data.items) || !!data._embedded)
    if (!valid) { health.api='unknown'; health.detail='The endpoint responded, but its API response could not be verified.'; return health }
    health.api='verified'; health.apiVersion=revision; health.authentication=hasToken ? 'verified':'unknown'
    health.productVersion=type === 'vbr' ? field(data?.buildVersion) : type === 'vb365' ? field(data?.version) : null
    health.serverName=type === 'vbr' || type === 'vb365' ? field(data?.name) : null
    health.serverPlatform=type === 'vbr' ? field(data?.platform) : null
    health.detail=hasToken ? 'Authenticated read succeeded. This check does not assert backup health or access to every API resource.':'API response verified without an authenticated token; authentication remains unverified.'
    return health
  } catch {
    if (health.connection === 'reachable') { health.api='unknown'; health.detail='The endpoint responded but did not return a readable API response.' }
    else { health.connection='unreachable'; health.api='unknown'; health.detail='No API response received. Check the endpoint, network, TLS and service availability.' }
    return health
  } finally { health.latencyMs=Math.max(0,now()-start); health.checkedAt=new Date(now()).toISOString() }
}
