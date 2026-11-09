// Open Backup UI v1.0.2
export type ThroughputSample = {
  at: number
  bytesPerSecond: number
  basis: 'session' | 'task' | 'disk' | 'transferred'
  disk?: string
  logId?: number
  taskId?: string
  taskName?: string
}

export type ThroughputHistory = {samples: ThroughputSample[]; expiresAt: number | null}

const quantity = /^(\d+(?:[.,]\d+)?)\s*([kKMGTPE]?)(i?)(B|b|bytes?|bits?)(\/s|\/sec|ps)?$/

function bytes(text: string, rate: boolean, impliedPerSecond = false) {
  const match = quantity.exec(text.trim())
  if (!match || (rate ? !match[5] && !impliedPerSecond : Boolean(match[5]))) return
  const [, amount, prefix, binary, unit] = match
  const exponent = prefix ? 'KMGTPE'.indexOf(prefix.toUpperCase()) + 1 : 0
  if (binary && !exponent) return
  const bits = unit === 'b' || unit.startsWith('bit')
  const value = Number(amount.replace(',', '.')) * (binary ? 1024 : 1000) ** exponent / (bits ? 8 : 1)
  return Number.isFinite(value) && value <= Number.MAX_SAFE_INTEGER ? value : undefined
}

// Some documented SessionProgress.processingRate examples omit "/s". Only that native
// rate field supplies the implied time unit; plain size/log fields never do.
export function processingBytesPerSecond(text?: string | null) {
  return text && text.length < 80 ? bytes(text, true, true) : undefined
}

export function parseRestoreDisk(title?: string | null): {disk:string; bytesPerSecond?:number; restoredBytes?:number} | null {
  if (!title || title.length > 2048) return null
  const match = /^Restoring\s+((?:hard disk|virtual disk|disk)\s+\d+)\s*(?:\([^()\r\n]+\))?(?:\s*:\s*(.+))?$/i.exec(title.trim())
  if (!match) return null
  const disk = match[1].replace(/\s+/g, ' ')
  const measurement = /^(.+?)\s+restored at\s+(.+?)(?:\s+\[[^\]\r\n]*\])?$/i.exec(match[2] || '')
  if (!measurement) return {disk}
  return {disk, restoredBytes:bytes(measurement[1], false), bytesPerSecond:bytes(measurement[2], true)}
}
