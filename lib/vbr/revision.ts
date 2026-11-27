// Open Backup UI v1.3.0
import { TopologyRequestError } from '../topology/load'
import { canUseVbrRevision, isVbr13ServerInfo, vbrRevisions } from './version-response'

export type VbrRevision = typeof vbrRevisions[number]
export class UnsupportedVbrRevision extends TopologyRequestError {
  constructor() { super('The VBR server does not support the requested API revision.', 406) }
}

type Read = (path: string, revision: VbrRevision) => Promise<unknown>
export async function detectVbrRevision(read: Read): Promise<VbrRevision> {
  for (const revision of vbrRevisions) {
    let info: unknown
    try { info = await read('/api/v1/serverInfo', revision) }
    catch (error) {
      if (error instanceof UnsupportedVbrRevision) continue
      throw error
    }
    if (!isVbr13ServerInfo(info)) throw new TopologyRequestError('The source did not return valid VBR v13 or later server information.', 502)
    if (canUseVbrRevision(revision, info)) return revision
  }
  throw new UnsupportedVbrRevision()
}

// Cache successful checks only. Scope includes the endpoint and authenticated principal.
const confirmed = new Map<string, { revision: VbrRevision; expires: number }>()
const ttl = 5 * 60_000
export function cachedSourceRevision(scope:string): VbrRevision | undefined {
  const cached = confirmed.get(scope)
  return cached && cached.expires > Date.now() ? cached.revision : undefined
}
export async function sourceRevision(scope: string, read: Read): Promise<VbrRevision> {
  const cached = cachedSourceRevision(scope)
  if (cached) return cached
  const revision = await detectVbrRevision(read)
  confirmed.delete(scope)
  if (confirmed.size >= 256) confirmed.delete(confirmed.keys().next().value!)
  confirmed.set(scope, { revision, expires: Date.now() + ttl })
  return revision
}
