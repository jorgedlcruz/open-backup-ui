// Open Backup UI v1.3.0
import { z } from 'zod'
import type { VbrInventoryReader, VbrReader, VbrRevision } from '../server/vbr-read'
import { readOperationsCollection } from '../operations/load'
import { TopologyRequestError } from '../topology/load'
import type { Evidence } from '../investigation/model'
import { inventorySchema, backupSchema, backupKey, itemKey, manager, isManager, isVm, urnPart, meta, globalInventoryPlatforms, globalPlatformSchema, isExtendedPlatform, inventoryHierarchy, supportsInventoryScope, searchPageSize, type BackupObject, type InventoryItem, type InventoryLookupPage, type VirtualSnapshot } from './model'

export async function loadVirtualInventory(read:VbrReader,browse:VbrInventoryReader,sourceName:string,revision:VbrRevision,now=new Date(),
  options:{backups?:Promise<Evidence<BackupObject>>;hostMembership?:boolean}={}):Promise<VirtualSnapshot> {
  const warnings:string[]=[]
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
    options.backups ?? optional('Backup objects',readOperationsCollection(path=>read(path,revision),'/api/v1/backupObjects',backupSchema,20000,backupKey)),
  ])
  const bulkPlatforms=revision==='1.3-rev3' ? globalInventoryPlatforms.filter(p=>roots.data.some(i=>i.platform===p)) : []
  const children:Evidence<InventoryItem>[]=[]
  const bulkLoaded=new Set<string>()
  const searchPlatforms:VirtualSnapshot['searchPlatforms']=[]
  const managedVsphere=new Set(roots.data.filter(i=>i.platform==='VSphere' && isManager(i)).map(manager))
  const standalone=new Set(roots.data.filter(i=>i.platform==='VSphere' && i.type==='Host' && !managedVsphere.has(manager(i))).map(manager))
  const bulkResults=await Promise.all(bulkPlatforms.map(async platform=>{
    try {
      const page=await collection(null,undefined,20000,(skip,limit)=>browse(null,skip,limit,revision,inventoryHierarchy(platform),{platform}))
      if(page.data.some(i=>i.platform!==platform))throw new Error('Unexpected inventory platform.')
      if(platform==='VSphere')page.data=page.data.filter(i=>!standalone.has(manager(i)))
      return {platform,page}
    }catch(error){
      if(error instanceof TopologyRequestError && error.status===401)throw error
      // Some source roles/plugins expose manager browsing but cannot use the platform-wide operation.
    }
  }))
  for(const result of bulkResults)if(result){
    const {platform,page}=result
    if(!page.complete)warnings.push(`Inventory for ${platform}: partial collection. Counts cover loaded records only.`)
    children.push(page)
    bulkLoaded.add(platform)
    searchPlatforms.push(platform)
  }
  function canBrowseManager(i:InventoryItem) {
    if(!i.platform || bulkLoaded.has(i.platform) || manager(i)==='Not reported')return false
    if(revision==='1.3-rev3' && (isExtendedPlatform(i.platform) || ['Proxmox','Nutanix','HyperV'].includes(i.platform)))return true
    return globalPlatformSchema.safeParse(i.platform).success && (isManager(i)||i.type==='HyperV')
  }
  const targets=[...new Map(roots.data.filter(canBrowseManager).map(i=>[JSON.stringify([i.platform,manager(i)]),i])).values()]
  if(targets.length>30)warnings.push('Inventory browse is limited to 30 servers. Additional servers remain listed without their children.')
  for(let offset=0;offset<Math.min(targets.length,30);offset+=4){
    children.push(...await Promise.all(targets.slice(offset,Math.min(offset+4,30)).map(i=>optional(`Inventory for ${manager(i)}`,collection(manager(i),inventoryHierarchy(i.platform))))))
  }
  const merged=[...new Map([...roots.data,...children.flatMap(c=>c.data)].map(i=>[itemKey(i),i])).values()]
  const hosts=options.hostMembership===false ? [] : merged.filter(i=>i.platform==='VSphere' && i.type==='Host' && i.name && i.objectId &&
    merged.some(vm=>isVm(vm) && manager(vm)===manager(i) && !urnPart(vm.urn,'hostsystem') && !urnPart(vm.urn,'esx') && !urnPart(vm.urn,'host') && !meta(vm,['hostObjectId'])))
  const knownVms=new Set(merged.filter(isVm).map(itemKey))
  const hostLinks:NonNullable<VirtualSnapshot['hostLinks']>={data:[],available:true,complete:hosts.length<=40}
  for(let offset=0;offset<Math.min(hosts.length,40);offset+=4) {
    const results=await Promise.all(hosts.slice(offset,Math.min(offset+4,40)).map(async host=>{
      const membership=await optional(`VM membership for ${host.name}`,collection(null,undefined,5000,(skip,limit)=>{
        const query=new URLSearchParams({skip:String(skip),limit:String(limit),parentContainerNameFilter:host.name!,typeFilter:'VirtualMachine',hierarchyTypeFilter:'HostsAndClusters'})
        if(supportsInventoryScope(revision))query.set('permissionScope','Any')
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
  const unscopedIdentityComplete=complete && roots.data.filter(i=>globalPlatformSchema.safeParse(i.platform).success || isExtendedPlatform(i.platform)).every(i=>
    (bulkLoaded.has(i.platform || '') && !(i.platform==='VSphere' && standalone.has(manager(i)))) || canBrowseManager(i))
  return {sourceName,fetchedAt:now.toISOString(),apiRevision:revision,warnings,backups,hostLinks,unscopedIdentityComplete,searchPlatforms,inventory:{data:merged.slice(0,20000),available:true,complete}}
}

export async function searchVirtualInventory(browse:VbrInventoryReader,revision:VbrRevision,params:URLSearchParams):Promise<InventoryLookupPage> {
  if(revision!=='1.3-rev3')throw new TopologyRequestError('Platform inventory search is unavailable.',400)
  const platform=globalPlatformSchema.safeParse(params.get('platform'))
  const name=(params.get('name') || '').trim(),rawSkip=params.get('skip') ?? '0',skip=Number(rawSkip)
  if(!platform.success || !name || name.length>200 || !/^\d+$/.test(rawSkip) || !Number.isSafeInteger(skip) || skip>2147483647)
    throw new TopologyRequestError('Invalid inventory search.',400)
  const raw=await browse(null,skip,searchPageSize,revision,inventoryHierarchy(platform.data),{platform:platform.data,name})
  const page=z.object({data:z.array(inventorySchema),pagination:z.object({total:z.number().int().nonnegative(),count:z.number().int().optional(),skip:z.number().int().optional()})}).safeParse(raw)
  if(!page.success || page.data.data.length>searchPageSize || page.data.data.some(i=>i.platform!==platform.data) ||
    (page.data.pagination.skip!==undefined && page.data.pagination.skip!==skip) || (page.data.pagination.count!==undefined && page.data.pagination.count!==page.data.data.length) ||
    (!page.data.data.length && skip<page.data.pagination.total))throw new TopologyRequestError('The source could not return the expected records.',502)
  return {items:page.data.data,skip,total:page.data.pagination.total}
}
