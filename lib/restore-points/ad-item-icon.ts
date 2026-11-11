// Open Backup UI v1.2.0
import type { AdEntry } from './ad-client'

export type DirectoryIconKind = 'domain' | 'folder' | 'unit' | 'user' | 'group' | 'computer' | 'contact' | 'serviceAccount' | 'principal' | 'policy' | 'policyFolder' | 'dns' | 'configuration' | 'dfs' | 'printer' | 'server' | 'site' | 'subnet' | 'object'

const itemIcons: Readonly<Record<string, DirectoryIconKind>> = {
  user: 'user', inetorgperson: 'user', group: 'group', computer: 'computer',
  contact: 'contact', organizationalunit: 'unit', organisationunit: 'unit',
  msdsmanagedserviceaccount: 'serviceAccount', msdsgroupmanagedserviceaccount: 'serviceAccount',
  managedserviceaccount: 'serviceAccount', groupmanagedserviceaccount: 'serviceAccount',
  foreignsecurityprincipal: 'principal', grouppolicycontainer: 'policy', grouppolicyobject: 'policy',
  dnsnode: 'dns', dnsrecord: 'dns', dnszone: 'dns', domaindns: 'domain', domain: 'domain',
  printqueue: 'printer', printer: 'printer', server: 'server', site: 'site', subnet: 'subnet',
  container: 'folder',
}
const normalized = (value?: string) => value?.toLowerCase().replace(/[\s_-]/g, '') || ''

/** Object names are user data; only VBR's type metadata determines the glyph. */
export function directoryIconKind(entry: Pick<AdEntry, 'type' | 'itemType' | 'containerType'>): DirectoryIconKind {
  if (entry.type === 'domain') return 'domain'
  if (entry.type === 'container') {
    if (normalized(entry.itemType) === 'organizationalunit') return 'unit'
    switch (normalized(entry.containerType)) {
      case 'grouppolicyobjects': return 'policyFolder'
      case 'integrateddns': return 'dns'
      case 'configurationpartition': return 'configuration'
      case 'dfsconfiguration': return 'dfs'
      default: return 'folder'
    }
  }
  return entry.type === 'item' ? itemIcons[normalized(entry.itemType)] || 'object' : 'object'
}
