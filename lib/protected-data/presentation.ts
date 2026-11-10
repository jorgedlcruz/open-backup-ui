// Open Backup UI v1.2.0
import { enumLabel, type Translator } from '../i18n/presentation'
import { vbrError } from '../i18n/vbr-errors'
import { repositoryId, type Row } from './model'
import { facetValue, meta, urnPart, type Facet, type VirtualRow } from '../virtual-infrastructure/model'

/** Preserve names from the source; only format an application-generated absence. */
export function protectedRepositoryLabel(t: Translator, row: Row): string {
  return row.backup?.repositoryName || row.object.repositoryName || repositoryId(row) || t('Not reported')
}

export function virtualContextLabel(t: Translator, row: VirtualRow, field: 'manager' | 'datacenter' | 'cluster' | 'host' | 'dns' | 'os'): string {
  if (field === 'manager') return row.item.hostName || urnPart(row.item.urn, 'vc') || urnPart(row.item.urn, 'scvmm') || t('Not reported')
  if (field === 'dns') return meta(row.item, ['dnsName']) || t('Not reported')
  if (field === 'os') return meta(row.item, ['guestOsName', 'GuestOS']) || t('Not reported')
  return row[field].key === 'unknown' ? t('Not reported') : row[field].name
}

/** Facet values remain model identifiers; presentation follows the value's origin. */
export function virtualFacetLabel(t: Translator, row: VirtualRow, facet: Facet): string {
  if (facet === 'manager' || facet === 'datacenter' || facet === 'cluster' || facet === 'host' || facet === 'os') {
    return virtualContextLabel(t, row, facet)
  }
  return enumLabel(t, facetValue(row, facet))
}

/** Translate only known application diagnostics, never arbitrary provider messages. */
export function inventoryDiagnostic(t: Translator, value: string, formatNumber: (value: number) => string = String): string {
  switch (value) {
    case 'Matching backup objects exist. This does not establish job coverage or recovery-point freshness.': return t('Matching backup objects exist. This does not establish job coverage or recovery-point freshness.')
    case 'Object ID is ambiguous or other server scopes have not been browsed; backup paths did not resolve it.': return t('Object ID is ambiguous or other server scopes have not been browsed; backup paths did not resolve it.')
    case 'Backup evidence or object identity is incomplete.': return t('Backup evidence or object identity is incomplete.')
    case 'No matching backup objects were returned by the loaded source.': return t('No matching backup objects were returned by the loaded source.')
    case 'No usable backup reference was returned. Open all workload restore points to investigate.': return t('No usable backup reference was returned. Open all workload restore points to investigate.')
    case 'The source did not honor the latest-point limit.': return t('The source did not honor the latest-point limit.')
    case 'The returned restore point belongs to a different backup. Its time cannot describe this copy.': return t('The returned restore point belongs to a different backup. Its time cannot describe this copy.')
    case 'The returned platform does not match this object.': return t('The returned platform does not match this object.')
    case 'The returned creation time is invalid or in the future.': return t('The returned creation time is invalid or in the future.')
    case 'Recovery time unavailable.': return t('Recovery time unavailable.')
    case 'Server version unavailable. Using API 1.3-rev1.': return t('Server version unavailable. Using API 1.3-rev1.')
    case 'Read permission is unavailable.': return t('Read permission is unavailable.')
    case 'The expected data was not returned.': return t('The expected data was not returned.')
    case 'Your account cannot read these records.': return t('Your account cannot read these records.')
    case 'The source could not return the expected records.': return t('The source could not return the expected records.')
    case 'Protected-object inventory is partial. Counts describe loaded records only.': return t('Protected-object inventory is partial. Counts describe loaded records only.')
    case 'Backup membership lookup is limited to 50 parents. Unresolved copy relationships remain unknown.': return t('Backup membership lookup is limited to 50 parents. Unresolved copy relationships remain unknown.')
    case 'Additional backup metadata is limited to 50 explicit references. Other locations remain unknown.': return t('Additional backup metadata is limited to 50 explicit references. Other locations remain unknown.')
    case 'File accounting is limited to 100 backups. Remaining backups stay visible with unmeasured consumption.': return t('File accounting is limited to 100 backups. Remaining backups stay visible with unmeasured consumption.')
    case 'Backup file size is a measured subtotal. Some file inventories, sizes, or backup scopes are unavailable.': return t('Backup file size is a measured subtotal. Some file inventories, sizes, or backup scopes are unavailable.')
    case 'Recovery-time lookups are limited to 100 backup-object records. Other RPO states remain unknown.': return t('Recovery-time lookups are limited to 100 backup-object records. Other RPO states remain unknown.')
    case 'Inventory browse is limited to 30 servers. Additional servers remain listed without their children.': return t('Inventory browse is limited to 30 servers. Additional servers remain listed without their children.')
    case 'VM-to-host membership is limited to 40 hosts. Remaining relationships are not inferred.': return t('VM-to-host membership is limited to 40 hosts. Remaining relationships are not inferred.')
    case 'Root server inventory is partial.': return t('Root server inventory is partial.')
    case 'Inventory display is limited to 20,000 unique objects. Protection matches without a server path may be unresolved.': return t('Inventory display is limited to 20,000 unique objects. Protection matches without a server path may be unresolved.')
    case 'Recovery times could not be loaded.': return t('Recovery times could not be loaded.')
    case 'Protected data could not be loaded.': return t('Protected data could not be loaded.')
    case 'Investigation data could not be loaded.': return t('Investigation data could not be loaded.')
  }
  const conflict = /^(\d+) conflicting file identities were excluded from storage accounting\.$/.exec(value)
  if (conflict) return t('{count} conflicting file identities were excluded from storage accounting.', { count: formatNumber(Number(conflict[1])) })

  const sections: Record<string, string> = {
    'Backup inventory': t('Backup inventory'), 'Backup membership': t('Backup membership'),
    'Referenced backup metadata': t('Referenced backup metadata'), 'Backup file inventory': t('Backup file inventory'),
    'Latest restore-point times': t('Latest restore-point times'), 'Backup objects': t('Backup objects'),
  }
  const section = (raw: string): string | undefined => {
    if (Object.prototype.hasOwnProperty.call(sections, raw)) return sections[raw]
    const inventory = /^Inventory for (.+)$/.exec(raw)
    if (inventory) return t('Inventory for {name}', { name: inventory[1] })
    const membership = /^VM membership for (.+)$/.exec(raw)
    if (membership) return t('VM membership for {name}', { name: membership[1] })
    return undefined
  }
  const partial = /^(.+): partial collection\. (?:Only loaded records are included|Counts cover loaded records only)\.$/.exec(value)
  if (partial) {
    const translated = section(partial[1])
    if (translated) return t('{section}: partial collection. Only loaded records are included.', { section: translated })
  }
  const unavailable = /^(.+) unavailable\. (.*)$/.exec(value)
  if (unavailable) {
    const translated = section(unavailable[1])
    if (translated) return t('{section} unavailable. {reason}', { section: translated, reason: inventoryDiagnostic(t, unavailable[2], formatNumber) })
  }
  return vbrError(t, value)
}
