import { z } from 'zod'
import { uuid, type Evidence } from '../investigation/model'

const text = z.string().nullish(), flag = z.boolean().nullish()
export const inventorySchema = z.object({
  platform: text, type: text, hostName: text, name: text, objectId: text, urn: text, size: text,
  powerState: text, isEnabled: flag, parentObjectId: text, clusterId: text, nodeId: text, prismCentralId: text,
  metadata: z.array(z.object({ field: text, data: text })).nullish(),
})
export const backupSchema = z.object({
  id: z.string().regex(uuid).transform(v=>v.toLowerCase()), name: text, objectId: text, platformName: text,
  path: text, type: text, viType: text, backupId: text, restorePointsCount: z.number().int().nonnegative().nullish(),
  lastRunFailed: flag, size: z.number().finite().nullish(),
})
export type InventoryItem = z.infer<typeof inventorySchema>
export type BackupObject = z.infer<typeof backupSchema>
// The same protected object ID can occur in several backups with different results and sizes.
export const backupKey = (b:BackupObject) => `${b.id}|${b.backupId || ''}`
export type VirtualSnapshot = {
  sourceName: string; fetchedAt: string; apiRevision: string; warnings: string[];
  inventory: Evidence<InventoryItem>; backups: Evidence<BackupObject>;
  hostLinks?: Evidence<{vmKey:string;hostKey:string}>;
  unscopedIdentityComplete?: boolean;
}
export const norm = (s?: string | null) => (s || '').trim().toLowerCase()
export const manager = (i: InventoryItem) => i.hostName || urnPart(i.urn,'vc') || urnPart(i.urn,'scvmm') || 'Not reported'
export const itemKey = (i: InventoryItem) => [norm(i.platform),norm(manager(i)),i.type || '',norm(i.objectId) || i.urn || i.name || 'unknown'].join('|')
export function urnPart(urn: string | null | undefined, type: string) {
  const part = urn?.split(';').find(p => p.slice(0,p.indexOf(':')).toLowerCase() === type.toLowerCase())
  return part ? part.slice(part.indexOf(':')+1) : null
}
export function meta(item: InventoryItem, fields: string[]) {
  return item.metadata?.find(m=>fields.some(f=>norm(f)===norm(m.field)))?.data || null
}
export const isVm = (i: InventoryItem) => i.type === 'VirtualMachine'
export const isManager = (i: InventoryItem) => ['vCenterServer','VMC','Scvmm','SCVMMServer','CloudDirectorServer','PrismCentral'].includes(i.type || '')
export const isHost = (i: InventoryItem) => ['Host','HyperV','Node','ProxmoxNode'].includes(i.type || '')
export const power = (i: InventoryItem) => i.powerState === 'PoweredOn' ? 'Running' : i.powerState === 'PoweredOff' ? 'Stopped'
  : i.powerState === 'Suspended' ? 'Suspended' : i.powerState || (i.isEnabled === true ? 'Enabled (legacy)' : i.isEnabled === false ? 'Disabled (legacy)' : 'Not reported')
export function sizeOrder(size?: string | null) {
  const m=size?.trim().match(/^([\d,.]+)\s*(B|KB|MB|GB|TB|PB|KiB|MiB|GiB|TiB|PiB)$/i)
  if(!m) return null
  const n=Number(m[1].replaceAll(',','')), unit=m[2].toUpperCase()
  const exponent=['B','K','M','G','T','P'].indexOf(unit==='B' ? 'B':unit[0])
  return Number.isFinite(n) && exponent>=0 ? n * (unit.includes('I') ? 1024:1000)**exponent : null
}
export type Location = { key: string; name: string }
export type VirtualRow = {
  item: InventoryItem; key: string; manager: Location; datacenter: Location; cluster: Location; host: Location;
  dns: string; os: string; power: string; protection: 'Protected'|'Unprotected'|'Unknown'|'Not applicable';
  backups: BackupObject[]; protectionNote: string; backupIssue: boolean; zeroPoints: boolean;
}
const absent = ():Location => ({key:'unknown',name:'Not reported'})
function platformName(i: InventoryItem) { return i.platform === 'VSphere' ? 'VMware':i.platform || '' }
export function buildVirtualRows(data: VirtualSnapshot): VirtualRow[] {
  const unique = [...new Map(data.inventory.data.map(i=>[itemKey(i),i])).values()]
  const byScope = new Map<string,InventoryItem[]>()
  const byKey=new Map(unique.map(i=>[itemKey(i),i])), linkedHosts=new Map<string,Set<string>>()
  for(const link of data.hostLinks?.data || []) {
    const links=linkedHosts.get(link.vmKey)||new Set<string>();links.add(link.hostKey);linkedHosts.set(link.vmKey,links)
  }
  const peersById = new Map<string,number>(), backupsById = new Map<string,BackupObject[]>()
  for(const i of unique) {const key=[norm(i.platform),norm(manager(i)),norm(i.objectId)].join('|');byScope.set(key,[...(byScope.get(key)||[]),i])}
  for(const i of unique) if(isVm(i) && i.objectId) {
    const key=`${norm(platformName(i))}|${norm(i.objectId)}`
    peersById.set(key,(peersById.get(key)||0)+1)
  }
  for(const b of new Map(data.backups.data.map(b=>[backupKey(b),b])).values()) {
    const key=`${norm(b.platformName)}|${norm(b.objectId)}`
    const list=backupsById.get(key)
    if(list)list.push(b);else backupsById.set(key,[b])
  }
  const find = (i:InventoryItem, ref:string|null|undefined, types:string[]) => {
    if(!ref) return absent()
    const hits=(byScope.get([norm(i.platform),norm(manager(i)),norm(ref)].join('|'))||[]).filter(x=>types.includes(x.type || ''))
    return hits.length===1 ? {key:itemKey(hits[0]),name:hits[0].name || ref}:{key:`${norm(i.platform)}|${norm(manager(i))}|ref:${norm(ref)}`,name:ref}
  }
  return unique.map(item=>{
    const scope=[norm(item.platform),norm(manager(item))].join('|')
    const m:Location={key:scope,name:manager(item)}
    // A Hyper-V parent can be a cluster or folder; only infer a host from a resolved host parent.
    const parentHost=item.parentObjectId && (byScope.get(`${scope}|${norm(item.parentObjectId)}`)||[]).some(isHost)
    const hostRef=urnPart(item.urn,'hostsystem') || urnPart(item.urn,'esx') || urnPart(item.urn,'host') || item.nodeId || (parentHost ? item.parentObjectId:null)
    const hostItem=hostRef ? (byScope.get(`${scope}|${norm(hostRef)}`)||[]).find(i=>isHost(i)):undefined
    const datacenter=find(item,urnPart(item.urn,'datacenter'),['Datacenter'])
    const cluster=find(item,urnPart(item.urn,'cluster') || item.clusterId || urnPart(hostItem?.urn,'cluster'),['Cluster'])
    const links=linkedHosts.get(itemKey(item)), linked=links?.size===1 ? byKey.get([...links][0]):undefined
    const host=isHost(item) ? {key:itemKey(item),name:item.name || item.objectId || 'Not reported'}
      : hostRef ? find(item,hostRef,['Host','HyperV','Node','ProxmoxNode'])
        : linked ? {key:itemKey(linked),name:linked.name || linked.objectId || 'Not reported'}:absent()
    const identity=`${norm(platformName(item))}|${norm(item.objectId)}`
    const candidates = isVm(item) && item.objectId ? backupsById.get(identity)||[]:[]
    const peers = peersById.get(identity)||0
    const pathHost = (b:BackupObject) => b.path?.includes('\\') ? norm(b.path.split('\\')[0]):null
    const identityComplete=data.inventory.complete && data.unscopedIdentityComplete!==false
    const backups=candidates.filter(b=>pathHost(b) ? pathHost(b)===norm(manager(item)) : peers===1 && identityComplete)
    const ambiguous=candidates.some(b=>!pathHost(b) && (peers!==1 || !identityComplete))
    const protection = !isVm(item) ? 'Not applicable' : backups.length ? 'Protected'
      : !item.objectId || !['VSphere','HyperV','CloudDirector','Nutanix','Proxmox'].includes(item.platform || '') || !data.backups.complete || !data.backups.available || ambiguous ? 'Unknown':'Unprotected'
    return {item,key:itemKey(item),manager:m,datacenter,cluster,host,dns:meta(item,['dnsName']) || 'Not reported',
      os:meta(item,['guestOsName','GuestOS']) || 'Not reported',power:power(item),protection,backups,
      protectionNote:backups.length ? 'Matching backup objects exist. This does not establish job coverage or recovery-point freshness.'
        : ambiguous ? 'Object ID is ambiguous or other server scopes have not been browsed; backup paths did not resolve it.'
          : protection==='Unknown' ? 'Backup evidence or object identity is incomplete.' : 'No matching backup objects were returned by the loaded source.',
      backupIssue:backups.some(b=>b.lastRunFailed===true),
      zeroPoints:backups.length>0 && backups.every(b=>b.restorePointsCount===0),
    } as VirtualRow
  })
}
export type VirtualView = 'vms'|'managers'|'clusters'|'hosts'|'all'
export type VirtualIssue = 'all'|'unprotected'|'runningUnprotected'|'backupErrors'|'noPoints'|'unknown'|'stopped'
export type Facet = 'protection'|'manager'|'datacenter'|'cluster'|'host'|'power'|'os'|'type'|'platform'
export type VirtualFilters = { query:string; issue:VirtualIssue; facets:Partial<Record<Facet,string[]>> }
export const defaultVirtualFilters:VirtualFilters={query:'',issue:'all',facets:{}}
export function inView(row:VirtualRow,view:VirtualView) { return view==='all' || (view==='vms' ? isVm(row.item) : view==='managers' ? isManager(row.item):view==='clusters' ? row.item.type==='Cluster':isHost(row.item)) }
export function facetValue(row:VirtualRow,facet:Facet) {
  return ['manager','datacenter','cluster','host'].includes(facet) ? (row[facet as 'manager'|'host'] as Location).key
    : facet==='type' || facet==='platform' ? row.item[facet] || 'Not reported':row[facet as 'protection'|'power'|'os']
}
export function matchesVirtual(row:VirtualRow,filters:VirtualFilters,omit?:Facet) {
  const q=norm(filters.query)
  if(q && ![row.item.name,row.item.objectId,row.item.urn,row.dns,row.os,row.item.size,row.manager.name,row.datacenter.name,row.cluster.name,row.host.name].join(' ').toLowerCase().includes(q))return false
  for(const [field,values] of Object.entries(filters.facets)) if(field!==omit && values?.length && !values.includes(facetValue(row,field as Facet))) return false
  return filters.issue==='all' || (filters.issue==='unprotected' ? row.protection==='Unprotected'
    : filters.issue==='runningUnprotected' ? row.protection==='Unprotected' && row.power==='Running'
    : filters.issue==='backupErrors' ? row.backupIssue : filters.issue==='noPoints' ? row.zeroPoints
    : filters.issue==='unknown' ? row.protection==='Unknown' || (isVm(row.item) && !['Running','Stopped','Suspended'].includes(row.power))
    : row.power==='Stopped' || row.power==='Suspended')
}
export function sortVirtual(rows:VirtualRow[],order:string) {
  const rank=(r:VirtualRow)=>r.backupIssue ? 0:r.zeroPoints ? 1:r.protection==='Unprotected' ? 2:r.protection==='Unknown' ? 3:4
  return [...rows].sort((a,b)=>{
    if(order==='sizeDesc' || order==='sizeAsc') {
      const x=sizeOrder(a.item.size),y=sizeOrder(b.item.size)
      if(x===null && y!==null)return 1
      if(y===null && x!==null)return -1
      if(x!==null && y!==null && x!==y)return (x-y)*(order==='sizeDesc' ? -1:1)
    }
    return (order==='risk' ? rank(a)-rank(b):0) || (a.item.name || a.key).localeCompare(b.item.name || b.key)
  })
}
export function memberVms(row:VirtualRow,rows:VirtualRow[]) {
  return rows.filter(vm=>isVm(vm.item) && (isManager(row.item) ? vm.manager.key===row.manager.key
    : row.item.type==='Datacenter' ? vm.datacenter.key===row.key : row.item.type==='Cluster' ? vm.cluster.key===row.key
    : isHost(row.item) ? vm.host.key===row.key:false))
}
export function membershipIndex(rows:VirtualRow[]) {
  const locations=new Map<string,VirtualRow[]>()
  for(const vm of rows)if(isVm(vm.item))for(const field of ['manager','datacenter','cluster','host'] as const) {
    if(vm[field].key==='unknown')continue
    const key=`${field}|${vm[field].key}`,list=locations.get(key)
    if(list)list.push(vm);else locations.set(key,[vm])
  }
  return new Map(rows.filter(r=>!isVm(r.item)).map(r=>{
    const key=isManager(r.item) ? `manager|${r.manager.key}`:r.item.type==='Datacenter' ? `datacenter|${r.key}`:r.item.type==='Cluster' ? `cluster|${r.key}`:isHost(r.item) ? `host|${r.key}`:''
    return [r.key,locations.get(key)||[]]
  }))
}
export function canQuickBackup(i:InventoryItem) { return isVm(i) && i.platform==='VSphere' && !!i.hostName && !!i.objectId && !!i.name }
