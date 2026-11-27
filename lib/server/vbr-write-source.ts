// Open Backup UI v1.3.0
import { createHash } from 'node:crypto'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import { TopologyRequestError } from '../topology/load'
import { configStore } from './config-store'
import { tokenManager } from './token-manager'
import { vbrBrowserToken } from './vbr-browser-token'

export async function selectedVbrWriteSource(request: NextRequest, expectedKey: string) {
  const jar = await cookies()
  const sourceId = jar.get('veeam_source_id')?.value
  const source = sourceId ? configStore.getById(sourceId) : undefined
  if (sourceId && source?.platform !== 'vbr') throw new TopologyRequestError('Select a valid VBR source.', 400)
  const base = source ? `${source.protocol}://${source.host}:${source.port}` : process.env.VEEAM_API_URL || process.env.VBR_API_URL
  if (!base) throw new TopologyRequestError('Connect a VBR source.', 400)
  const target = new URL(base)
  const key = createHash('sha256').update(JSON.stringify([target.href, source?.id || 'environment'])).digest('hex')
  if (expectedKey !== key || !['https:', 'http:'].includes(target.protocol) || target.username || target.password)
    throw new TopologyRequestError('The VBR source changed. Reload and validate again.', 409)
  let token = sourceId ? await tokenManager.getToken(sourceId) : null
  token ||= vbrBrowserToken(jar, target, sourceId, request.headers.get('authorization'))
  if (!token) throw new TopologyRequestError('Reconnect the VBR data source.', 401)
  return { target, token, sourceId }
}
