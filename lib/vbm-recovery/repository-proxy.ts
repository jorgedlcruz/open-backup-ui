// Open Backup UI v1.3.0
import { z } from 'zod'
import { collection } from '../vbm-dashboard/load'
import { isRecoveryError, record, RecoveryError } from './model'
import type { Execute } from './transport'
import { proxyPollMs } from './proxy-wait-policy'

const guid = z.string().uuid()
const nil = '00000000-0000-0000-0000-000000000000'
const member = z.object({ id: guid, status: z.string() })
const expired = () => new RecoveryError('Veeam could not open the backup within the 30-minute proxy wait. Check the repository proxy before trying again.', 503)
function ownerId(value: unknown) {
  const id = guid.safeParse(value)
  return id.success && id.data !== nil ? id.data.toLowerCase() : undefined
}

// Use the owner of the verified restore point. Optional inventory reads must stay inexpensive.
export async function openWithRepositoryProxy<T>(execute: Execute, repositoryId: string | undefined, until: number,
  waiting: (value: boolean) => void, open: () => Promise<T>): Promise<T> {
  const repository = ownerId(repositoryId)
  async function offline() {
    if (!repository) return false
    const readUntil = Math.min(until, Date.now() + 5_000)
    const read = (path: string) => execute(path, 'GET', undefined, readUntil)
    try {
      const repo = record(await read('/v8/BackupRepositories/' + repository))
      if (ownerId(repo.id) !== repository) return false
      const proxy = ownerId(repo.proxyId), pool = ownerId(repo.proxyPoolId)
      if (pool) {
        const members = await collection(read, '/v8/ProxyPools/' + pool + '/proxies', member, row => row.id)
        return members.complete && members.data.length > 0 && members.data.every(row => row.status.toLowerCase() === 'offline')
      }
      if (proxy) {
        const status = record(await read('/v8/Proxies/' + proxy))
        return ownerId(status.id) === proxy && String(status.status).toLowerCase() === 'offline'
      }
      return false
    } catch {
      return false
    }
  }

  while (Date.now() < until) {
    if (!await offline()) {
      if (Date.now() >= until) throw expired()
      waiting(false)
      try {
        return await open()
      } catch (error) {
        // A definitive pre-creation rejection permits another attempt. An uncertain write must keep its receipt.
        if (!isRecoveryError(error) || error.code !== 'ProxyOffline' || error.outcomeUnknown) throw error
      }
    }
    waiting(true)
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(proxyPollMs, until - Date.now()))))
  }
  throw expired()
}
