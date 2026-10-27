import type { DataSource, PlatformType } from '../context/data-sources-context'
import { applicationRequest } from '../api/application-request'

const platforms = new Set(['vbr', 'vb365', 'vro', 'veeam-one', 'one', 'kasten'])
export function clientSources(value: unknown, cached = false): DataSource[] {
  if (!Array.isArray(value)) throw new Error('The application did not return a data-source inventory. Please retry.')
  return value.map(row => {
    if (!row || typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.url !== 'string' || !platforms.has(row.type)) {
      throw new Error('The application returned an invalid data source. Please retry.')
    }
    return {
      id: row.id, name: row.name, url: row.url, type: row.type as PlatformType,
      // The catalog identifies the selected source, not just its platform.
      isAuthenticated: !cached && row.isAuthenticated === true,
      hasCredentials: !cached && row.hasCredentials === true,
      ...(!cached && (row.managed === 'saved' || row.managed === 'environment') ? { managed: row.managed as 'saved' | 'environment' } : {}),
    }
  })
}

export async function loadClientSources(signal?: AbortSignal): Promise<DataSource[]> {
  return clientSources(await applicationRequest<unknown>('/api/config/sources', { signal }))
}
