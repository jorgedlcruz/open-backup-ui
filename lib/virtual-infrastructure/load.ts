import { z } from 'zod'
import type { VbrInventoryReader, VbrReader } from '../server/vbr-read'
import { readOperationsCollection } from '../operations/load'
import { TopologyRequestError } from '../topology/load'
import { revisionForBuild, type Evidence } from '../investigation/model'
import { inventorySchema, backupSchema, backupKey, itemKey, manager, isManager, isVm, urnPart, type InventoryItem, type VirtualSnapshot } from './model'

export async function loadVirtualInventory(read:VbrReader,browse:VbrInventoryReader,sourceName:string,now=new Date()):Promise<VirtualSnapshot> {
  const warnings:string[]=[]
  let revision:'1.3-rev1'|'1.3-rev2'='1.3-rev1'
  try { revision=revisionForBuild(z.object({buildVersion:z.string()}).parse(await read('/api/v1/serverInfo')).buildVersion) }
  catch(error) {if(error instanceof TopologyRequestError && error.status===401)throw error;warnings.push('Server version unavailable. Using API 1.3-rev1.')}
  async function collection(host:string|null,hierarchy?:'HostsAndClusters'|'HostsAndVms',max=5000,getPage?:(skip:number,limit:number)=>Promise<unknown>):Promise<Evidence<InventoryItem>> {
    const items=new Map<string,InventoryItem>();let skip=0
    for(let page=0;page<100;page++){
      const limit=Math.min(200,max-items.size)
      const response=z.object({data:z.array(inventorySchema),pagination:z.object({total:z.number().nonnegative().optional()}).nullish()}).parse(await (getPage ? getPage(skip,limit):browse(host,skip,limit,revision,hierarchy)))
      const before=items.size
      for(const item of response.data)if(items.size<max)items.set(itemKey(item),item)
      skip+=response.data.length
      const total=response.pagination?.total, result=(complete:boolean)=>({data:[...items.values()],available:true,complete})
      if(response.data.length && before===items.size)return result(false)
      if(total!==undefined && skip>=total)return result(items.size>=total)
      if(!response.data.length)return result(total===undefined || skip>=total)
      if(total===undefined && response.data.length<limit)return result(items.size>=skip)
      if(items.size>=max)return result(false)
    }
    return {data:[...items.values()],available:true,complete:false}
  }
  async function optional<T>(label:string,work:Promise<Evidence<T>>):Promise<Evidence<T>> {
    try {const result=await work;if(!result.complete)warnings.push(`${label}: partial collection. Counts cover loaded records only.`);return result}
    catch(error){if(error instanceof TopologyRequestError && error.status===401)throw error
      const reason=error instanceof TopologyRequestError && error.status===403 ? 'Your account cannot read these records.':'The source could not return the expected records.'
      warnings.push(`${label} unavailable. ${reason}`);return {data:[],available:false,complete:false,error:reason}}
  }
  const [roots,backups]=await Promise.all([
    collection(null),
    optional('Backup objects',readOperationsCollection(path=>read(path,revision),'/api/v1/backupObjects',backupSchema,20000,backupKey)),
  ])
  const virtualPlatforms=['VSphere','HyperV','CloudDirector','Nutanix','Proxmox']
  // Retain the existing managed-inventory scope. Browsing standalone ESXi registrations as well
  // can duplicate the same production VMs under different managed-object IDs.
  const targets=[...new Map(roots.data.filter(i=>virtualPlatforms.includes(i.platform || '') && (isManager(i)||i.type==='HyperV') && manager(i)!=='Not reported').map(i=>[manager(i),i])).values()]
  if(targets.length>30)warnings.push('Inventory browse is limited to 30 servers. Additional servers remain listed without their children.')
  const children:Evidence<InventoryItem>[]=[]
  for(let offset=0;offset<Math.min(targets.length,30);offset+=4){
    children.push(...await Promise.all(targets.slice(offset,Math.min(offset+4,30)).map(i=>optional(`Inventory for ${manager(i)}`,collection(manager(i),i.platform==='VSphere' ? 'HostsAndClusters':i.platform==='HyperV' ? 'HostsAndVms':undefined)))))
  }
  const merged=[...new Map([...roots.data,...children.flatMap(c=>c.data)].map(i=>[itemKey(i),i])).values()]
  const hosts=merged.filter(i=>i.platform==='VSphere' && i.type==='Host' && i.name && i.objectId &&
    merged.some(vm=>isVm(vm) && manager(vm)===manager(i) && !urnPart(vm.urn,'hostsystem') && !urnPart(vm.urn,'esx') && !urnPart(vm.urn,'host')))
  const knownVms=new Set(merged.filter(isVm).map(itemKey))
  const hostLinks:NonNullable<VirtualSnapshot['hostLinks']>={data:[],available:true,complete:hosts.length<=40}
  for(let offset=0;offset<Math.min(hosts.length,40);offset+=4) {
    const results=await Promise.all(hosts.slice(offset,Math.min(offset+4,40)).map(async host=>{
      const membership=await optional(`VM membership for ${host.name}`,collection(null,undefined,5000,(skip,limit)=>{
        const query=new URLSearchParams({skip:String(skip),limit:String(limit),parentContainerNameFilter:host.name!,typeFilter:'VirtualMachine',hierarchyTypeFilter:'HostsAndClusters',permissionScope:'Any'})
        return read(`/api/v1/inventory/vmware/hosts/${encodeURIComponent(manager(host))}?${query}`,revision)
      }))
      return {host,membership}
    }))
    for(const {host,membership} of results){
      if(!membership.complete)hostLinks.complete=false
      for(const vm of membership.data)if(isVm(vm) && knownVms.has(itemKey(vm)) && manager(vm)===manager(host))hostLinks.data.push({vmKey:itemKey(vm),hostKey:itemKey(host)})
    }
  }
  if(hosts.length>40)warnings.push('VM-to-host membership is limited to 40 hosts. Remaining relationships are not inferred.')
  const complete=roots.complete && children.every(c=>c.complete) && targets.length<=30 && merged.length<=20000
  if(!roots.complete)warnings.push('Root server inventory is partial.')
  if(merged.length>20000)warnings.push('Inventory display is limited to 20,000 unique objects. Protection matches without a server path may be unresolved.')
  const browsed=new Set(targets.map(manager))
  const unscopedIdentityComplete=complete && roots.data.filter(i=>virtualPlatforms.includes(i.platform || '')).every(i=>browsed.has(manager(i)))
  return {sourceName,fetchedAt:now.toISOString(),apiRevision:revision,warnings,backups,hostLinks,unscopedIdentityComplete,inventory:{data:merged.slice(0,20000),available:true,complete}}
}
