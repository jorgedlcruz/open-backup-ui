// Open Backup UI v1.3.0

export type Release = {
  tag: string
  url: string
  notes: string
  highlights: string[]
}

export type UpdateStatus = {
  installed: string
  state: 'available' | 'current' | 'ahead' | 'empty' | 'unavailable'
  release: Release | null
}

const stableTag = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function versionParts(tag: string) {
  const match = stableTag.exec(tag)
  if (!match) return null
  const parts = match.slice(1, 4).map(Number)
  return parts.every(Number.isSafeInteger) ? parts : null
}

export function releaseState(installed: string, latest: string): UpdateStatus['state'] {
  // Release tags are stable. A prerelease installation sorts below its stable counterpart.
  const local = /^v?(\d+\.\d+\.\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(installed)
  const current = local && versionParts(local[1])
  const remote = versionParts(latest)
  if (!current || !remote) return 'unavailable'
  for (let i = 0; i < current.length; i++) {
    if (remote[i] !== current[i]) return remote[i] > current[i] ? 'available' : 'ahead'
  }
  return local[2] ? 'available' : 'current'
}

function highlightsFrom(notes: string) {
  let fence = ''
  const lines = notes.split(/\r?\n/).filter(line => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (!marker) return !fence
    if (!fence) fence = marker
    else if (marker.startsWith(fence) && line.trim() === marker) fence = ''
    return false
  })
  const start = lines.findIndex(line => /^#{1,6}\s+(?:highlights|what['’]?s new)(?:\s*#*)?$/i.test(line.trim()))
  const section = start < 0 ? lines : lines.slice(start + 1)
  const end = start < 0 ? -1 : section.findIndex(line => /^#{1,6}\s/.test(line))
  const candidates = end < 0 ? section : section.slice(0, end)
  const bullets = candidates.filter(line => /^\s*[-*+]\s/.test(line))
  const summary = bullets.length ? bullets : candidates.filter(line => /^[\p{L}*]/u.test(line))
  return summary.map(line => line.trim().replace(/^[-*+]\s+/, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*`]/g, '').trim()).filter(Boolean).slice(0, 3)
    .map(text => text.length > 200 ? text.slice(0, 197).replace(/\s+\S*$/, '') + '…' : text)
}

export function parseRelease(payload: unknown): Release | null {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid release')
  const { tag_name: tag, prerelease, draft, body } = payload as Record<string, unknown>
  if (typeof tag !== 'string' || typeof prerelease !== 'boolean' || typeof draft !== 'boolean') throw new Error('Invalid release')
  if (prerelease || draft || !versionParts(tag)) return null
  if (body != null && typeof body !== 'string') throw new Error('Invalid release notes')
  const notes = body ?? ''
  return { tag, notes, highlights: highlightsFrom(notes), url: `https://github.com/jorgedlcruz/open-backup-ui/releases/tag/${encodeURIComponent(tag)}` }
}
