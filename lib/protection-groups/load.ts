import { z } from 'zod'
import type { VbrReader } from '../server/vbr-read'
import { readOperationsCollection } from '../operations/load'
import { TopologyRequestError } from '../topology/load'
import { revisionForBuild, validId, type Evidence } from '../investigation/model'
import { groupSchema, entitySchema, discoverySchema, discoveryGroup, type ProtectionInventory } from './model'

export async function loadProtectionInventory(raw: VbrReader, sourceName: string, groupId?: string, now = new Date()): Promise<ProtectionInventory> {
  if (groupId && !validId(groupId)) throw new TopologyRequestError('Invalid protection group ID.', 400)
  groupId = groupId?.toLowerCase()
  const warnings: string[] = []
  const from = new Date(now.getTime() - 30 * 86400000).toISOString()
  let revision: '1.3-rev1' | '1.3-rev2' = '1.3-rev1'
  try { revision = revisionForBuild(z.object({ buildVersion: z.string() }).parse(await raw('/api/v1/serverInfo')).buildVersion) }
  catch (error) {
    if (error instanceof TopologyRequestError && error.status === 401) throw error
    warnings.push('Server version unavailable. Using API 1.3-rev1; newer fields may not be returned.')
  }
  const read = (path: string) => raw(path, revision)
  async function optional<T>(label: string, work: Promise<Evidence<T>>): Promise<Evidence<T>> {
    try {
      const result = await work
      if (!result.complete) warnings.push(`${label}: partial collection. Counts cover loaded records only.`)
      return result
    } catch (error) {
      if (error instanceof TopologyRequestError && error.status === 401) throw error
      const reason = error instanceof TopologyRequestError && error.status === 403 ? 'Your account cannot read these records.'
        : error instanceof z.ZodError ? 'The response did not match the expected fields.' : 'The source could not return these records.'
      warnings.push(`${label} unavailable. ${reason}`)
      return { data: [], available: false, complete: false, error: reason }
    }
  }
  const [groups, entities, sessions] = await Promise.all([
    groupId ? read(`/api/v1/agents/protectionGroups/${groupId}?permissionScope=Any`).then(v => {
      const group = groupSchema.parse(v)
      if (group.id !== groupId) throw new TopologyRequestError('The source returned a different protection group.', 502)
      return { data: [group], available: true, complete: true }
    }) : readOperationsCollection(read, '/api/v1/agents/protectionGroups?permissionScope=Any', groupSchema),
    optional('Discovered entities', readOperationsCollection(read, groupId
      ? `/api/v1/agents/protectionGroups/${groupId}/discoveredEntities?permissionScope=Any`
      : '/api/v1/agents/discoveredEntities?permissionScope=Any', entitySchema)),
    optional('Discovery history (last 30 days)', readOperationsCollection(read,
      `/api/v1/sessions?typeFilter=AgentDiscovery&orderColumn=CreationTime&orderAsc=false&createdAfterFilter=${encodeURIComponent(from)}`, discoverySchema, 3000)),
  ])
  if (!groups.complete) warnings.unshift('Protection groups: partial collection. Counts cover loaded groups only.')
  const ids = new Set(groups.data.map(g => g.id))
  const outside = entities.data.filter(e => !e.protectionGroupId || !ids.has(e.protectionGroupId)).length
  if (outside) warnings.push(`${outside} discovered entities do not reference a loaded group and are excluded from its counts.`)
  if (groupId && outside) entities.complete = false
  const unlinked = sessions.data.filter(s => s.sessionType === 'AgentDiscovery' && !discoveryGroup(s, ids)).length
  if (!groupId && unlinked) warnings.push(`${unlinked} discovery sessions could not be linked to one loaded group by ID. Names are not used to infer membership.`)
  return { sourceName, fetchedAt: now.toISOString(), apiRevision: revision, from, warnings, groups, entities, sessions }
}
