// Open Backup UI v1.3.0
export const vbrRevisions = ['1.3-rev3', '1.3-rev2', '1.3-rev1', '1.3-rev0'] as const
// VBR's public token endpoint supports this header throughout the v13 family.
export const vbrLoginRevision = '1.3-rev0'

function record(data:unknown):data is Record<string,unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
}
function buildParts(data:unknown):number[] | undefined {
  if (!record(data) || typeof data.vbrId !== 'string' || !data.vbrId.trim() ||
    typeof data.name !== 'string' || !data.name.trim() ||
    typeof data.buildVersion !== 'string' || !/^\d{1,5}\.\d{1,5}\.\d{1,5}\.\d{1,10}$/.test(data.buildVersion)) return
  const parts = data.buildVersion.split('.').map(Number)
  return parts[0] >= 13 ? parts : undefined
}
export function isVbr13ServerInfo(data:unknown):boolean {
  return buildParts(data) !== undefined
}
export function canUseVbrRevision(revision:string, data:unknown):boolean {
  const parts = buildParts(data)
  if (!parts) return false
  const [major,minor,patch] = parts
  // Some gateways ignore x-api-version. Only trust a successful read if the installed release
  // can support that revision. An unfamiliar future major can still confirm a known contract.
  const maximum = major > 13 || minor >= 2 ? 3 : minor === 1 ? 2 : patch >= 1 ? 1 : 0
  return vbrRevisions.slice(3-maximum).some(candidate=>candidate===revision)
}
export function isVbrVersionRejection(status:number, body:unknown):boolean {
  if (![400,406,501].includes(status) || !record(body)) return false
  if (typeof body.errorCode === 'string' && /^(UnsupportedApiVersion|ApiVersionNotSupported)$/i.test(body.errorCode)) return true
  if (typeof body.message !== 'string') return false
  const message=body.message
  return /\b(?:(?:rest\s*)?api[ -]?(?:version|revision)|x-api-version|v?\d+\.\d+-rev\d+)\b/i.test(message) &&
    /(?:not supported|unsupported|does (?:not|n't) support|not implemented|supported (?:api |rest api )?(?:versions?|revisions?)\s*:)/i.test(message)
}
