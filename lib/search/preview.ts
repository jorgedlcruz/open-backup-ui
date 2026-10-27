import { z } from 'zod'
import { readOperationsCollection } from '../operations/load'
import { configSchema, configuredImmutability } from '../repositories/model'
import { isFlagged } from '../restore-points/model'
import { validId } from '../investigation/model'
import { collection, type Reader } from '../vbm-dashboard/load'
import { pointSchema, pointKey, summary, countLabel, coverage } from '../vbm-protected/model'
import { publicResult, type SearchItem, type PreviewResponse, type SearchFact } from './model'

const recoveryPoint = z.object({ id: z.string(), backupId: z.string(), creationTime: z.string().nullish(), malwareStatus: z.string().nullish() })
const dateFact = (value: string | null): SearchFact => value ? { label: 'Latest observed point', value, kind: 'date' } : { label: 'Latest observed point', value: 'Not reported' }

// Only the selected result is enriched. Never traverse all workloads, job logs,
// backup files or repository memberships to build a search preview.
export async function loadPreview(read: Reader, item: SearchItem, indexedAt: string, now = Date.now()): Promise<PreviewResponse> {
  const result = publicResult(item), warnings: string[] = []
  let complete = true, fetchedAt = indexedAt
  if (item.type === 'VBR Workload') {
    const points = await readOperationsCollection(read, `/api/v1/backupObjects/${encodeURIComponent(item.id)}/restorePoints?orderColumn=CreationTime&orderAsc=false`, recoveryPoint, 500)
    complete = points.complete
    const valid = points.data.filter(point => point.creationTime && Number.isFinite(Date.parse(point.creationTime)) && Date.parse(point.creationTime) <= now)
      .sort((a, b) => Date.parse(b.creationTime!) - Date.parse(a.creationTime!))
    const flagged = points.data.filter(point => isFlagged(point.malwareStatus)).length
    result.facts = [dateFact(valid[0]?.creationTime || null), { label: 'Restore points observed', value: `${points.data.length}${complete ? '' : '+'}` },
      { label: 'Flagged points observed', value: String(flagged) }, { label: 'RPO assessment', value: 'No target evaluated' }, ...(item.facts || []).slice(0, 2)]
    result.signal = flagged ? { label: 'Security review needed', tone: 'warning' } : points.data.length ? { label: 'Restore points available', tone: 'success' } : complete ? { label: 'No restore points', tone: 'warning' } : { label: 'Recovery evidence incomplete', tone: 'neutral' }
    result.note = 'Point-level evidence only. Open the workload for file-level signals, recovery options, and storage accounting.'
    if (!complete) warnings.push('Preview covers a partial collection of up to 500 points. Counts are lower bounds.')
    if (valid.length !== points.data.length) warnings.push('Some point dates are missing, invalid, or in the future; they are excluded from the latest date.')
    if (points.data.some(point => !point.malwareStatus)) warnings.push('Some points have no reported malware status. No flags does not establish a clean recovery.')
    fetchedAt = new Date(now).toISOString()
  } else if (item.type === 'VB365 Item' && item.detail) {
    const { objectType, organizationId } = item.detail
    const query = new URLSearchParams({ [`${objectType.toLowerCase()}Id`]: item.id, orderAsc: 'false' })
    if (validId(organizationId)) query.set('organizationId', organizationId)
    const points = await collection(read, `/v8/RestorePoints?${query}`, pointSchema, pointKey, 100)
    if (organizationId && points.data.some(point => point.organizationId && point.organizationId.toLowerCase() !== organizationId.toLowerCase())) {
      points.data = points.data.filter(point => !point.organizationId || point.organizationId.toLowerCase() === organizationId.toLowerCase())
      points.complete = false; warnings.push('Points outside the selected organization were excluded.')
    }
    const value = summary(points, now), label = coverage(value)
    complete = points.complete
    result.facts = [dateFact(value.latest), { label: 'Retained points observed', value: countLabel(value) },
      { label: 'Repositories observed', value: value.available ? `${value.repositories.length}${complete ? '' : '+'}` : 'Not reported' },
      { label: 'Protected content', value: value.content.join(', ') || 'Not reported' }, ...(item.facts || []).slice(0, 2)]
    result.signal = { label, tone: label === 'Restore points available' ? 'success' : label === 'No restore points' ? 'warning' : 'neutral' }
    result.note = 'Restore-point presence is not a recovery test or an RPO assessment.'
    if (!complete) warnings.push(points.error || 'Preview covers up to 100 points. Open the object for full history.')
    if (value.unknownDeletion) warnings.push('Records with an unknown deletion state are excluded from the retained count.')
    fetchedAt = new Date(now).toISOString()
  } else if (item.type === 'VBR Repository') {
    const config = configSchema.parse(await read(`/api/v1/backupInfrastructure/repositories/${encodeURIComponent(item.id)}`))
    if (config.id !== item.id) throw new Error('Repository identity mismatch')
    const immutability = configuredImmutability(config)
    result.facts = [...(item.facts || []), { label: 'Immutability', value: immutability.status }, { label: 'Immutable retention', value: immutability.period }]
    result.note = 'Repository configuration does not establish a restore point’s immutable-until date.'
    fetchedAt = new Date(now).toISOString()
  }
  return { result, warnings, complete, fetchedAt }
}
