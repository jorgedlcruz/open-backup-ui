// Open Backup UI v1.3.0
import { readCacheScope } from '../server/read-cache-scope'
import { cachedSourceRevision, sourceRevision, UnsupportedVbrRevision, type VbrRevision } from './revision'
import { isVbrVersionRejection } from './version-response'

async function versionRejected(response: Response) {
  if (![400,406,501].includes(response.status)) return false
  return isVbrVersionRejection(response.status, await response.clone().json().catch(()=>null))
}

function resolveForEndpoint(url: URL, authorization: string, signal?: AbortSignal | null) {
  const deadline = AbortSignal.timeout(5000)
  const probeSignal = signal ? AbortSignal.any([signal,deadline]) : deadline
  return sourceRevision(readCacheScope(url.origin+'/', authorization), async (path, version) => {
    const info = await fetch(new URL(path, url), {
      headers:{Authorization:authorization, Accept:'application/json', 'x-api-version':version},
      cache:'no-store', redirect:'error', signal:probeSignal,
    })
    if (await versionRejected(info)) throw new UnsupportedVbrRevision()
    if (!info.ok) throw new Error('The VBR revision check was unavailable.')
    return info.json()
  })
}

export async function legacyMutationRevision(url:URL, authorization:string, requested:VbrRevision, signal?:AbortSignal|null):Promise<VbrRevision> {
  const available = await resolveForEndpoint(url, authorization, signal).catch(()=>undefined)
  return available && available < requested ? available : requested
}

/** Existing callers retain their original wire contract on servers that support it. */
export async function fetchVbrCompatible(input: string | URL, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers)
  const requested = headers.get('x-api-version')
  const authorization = headers.get('authorization')
  if (!authorization || (requested!=='1.3-rev1' && requested!=='1.3-rev2')) return fetch(input, init)
  const url = new URL(input)
  if (!url.pathname.startsWith('/api/v1/'))
    return fetch(input, init)

  const scope = readCacheScope(url.origin + '/', authorization)
  const send = (version: VbrRevision) => {
    if (version===requested) return fetch(input, init)
    headers.set('x-api-version', version)
    return fetch(input, {...init, headers})
  }
  const maximumKnown = cachedSourceRevision(scope)
  if (maximumKnown) return send(maximumKnown < requested ? maximumKnown : requested)
  if ((init.method ?? 'GET').toUpperCase() !== 'GET') {
    // Decide before sending a mutation. Older installations with restricted serverInfo
    // access can still use the same declared request they could use before negotiation.
    return send(await legacyMutationRevision(url, authorization, requested, init.signal))
  }
  const response = await fetch(input, init)
  if (!await versionRejected(response)) return response
  const available = await resolveForEndpoint(url, authorization, init.signal).catch(()=>undefined)
  if (!available || available >= requested) return response
  await response.body?.cancel().catch(()=>{})
  return send(available)
}
