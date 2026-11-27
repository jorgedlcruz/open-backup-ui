// Open Backup UI v1.3.0
import { type BrowseInput, type CartItem, type RestoreInput, type JsonRecord, type Workload, RecoveryError, ownerBase, part } from './model'

const requireValue=(value:string|undefined,label:string)=>{if(!value)throw new RecoveryError(`Choose ${label} first.`);return value}
const query=(path:string,values:Record<string,string|number|boolean|undefined>)=>{const q=new URLSearchParams();for(const [key,value] of Object.entries(values))if(value!==undefined)q.set(key,String(value));return `${path}?${q}`}

export function browsePath(input:BrowseInput) {
  const {workload,kind,sessionId,ownerId,parentId,channelId}=input
  const base=ownerBase(sessionId,workload,kind==='owners' ? undefined:requireValue(ownerId,'an object'))
  const paging={offset:input.offset,limit:input.limit}
  if(kind==='owners')return query(base,{...paging,...(workload==='SharePoint' ? {parentId:parentId || 'root'}:{})})
  if(kind==='versions')return query(`${entityPath(sessionId,workload,{id:requireValue(input.itemId,'an item'),ownerId:ownerId!,kind:input.itemKind || 'document',channelId})}/${workload==='Teams' ? 'versions':'Versions'}`,paging)
  if(workload==='Exchange') {
    if(!['folders','items'].includes(kind))throw new RecoveryError('Unsupported Exchange browse resource.')
    return query(`${base}/${kind}`,{...paging,parentId:parentId || 'root'})
  }
  if(workload==='OneDrive' || workload==='SharePoint') {
    const resource=({folders:'Folders',documents:'Documents',libraries:'Libraries',lists:'Lists',items:'Items'} as Record<string,string>)[kind]
    if(!resource || workload==='OneDrive' && !['folders','documents'].includes(kind))throw new RecoveryError('Unsupported document browse resource.')
    return query(`${base}/${resource}`,{...paging,...(!['libraries','lists'].includes(kind) ? {parentId:parentId || 'root',...(['items','documents'].includes(kind) ? {includeFolders:true}:{})}:{})})
  }
  if(kind==='channels')return query(`${base}/channels`,paging)
  const channel=requireValue(channelId,'a channel')
  if(kind==='tabs')return query(`${base}/channels/${part(channel)}/tabs`,paging)
  if(kind==='files' || kind==='folders')return query(`${base}/files`,{...paging,channelId:channel,parentId:parentId || 'root',...(kind==='folders' ? {foldersOnly:true}:{})})
  if(kind==='posts') {
    if(parentId && !/^(?:-1|\d+)$/.test(parentId))throw new RecoveryError('Invalid Teams post thread.')
    return query(`${base}/posts`,{...paging,channelId:channel,parentId:parentId || '-1'})
  }
  throw new RecoveryError('Unsupported Teams browse resource.')
}

export function searchPath(input:BrowseInput,setId?:string) {
  const base=ownerBase(input.sessionId,input.workload,requireValue(input.ownerId,'an object'))
  let path:string
  if(input.workload==='Exchange')path=`${base}${input.parentId && input.parentId!=='root' ? `/folders/${part(input.parentId)}`:''}/search`
  else if(input.workload==='Teams') {
    if(!['files','posts','tabs'].includes(input.kind))throw new RecoveryError('Search Teams files, posts or tabs.')
    path=input.kind==='tabs' ? `${base}/channels/${part(requireValue(input.channelId,'a channel'))}/tabs/search`:`${base}/${input.kind}/search`
  }else {
    const resource=input.scopeKind==='folder'?'Folders':input.workload==='SharePoint'&&input.scopeKind==='library'?'Libraries':input.workload==='SharePoint'&&input.scopeKind==='list'?'Lists':undefined
    path=`${base}${resource && input.parentId && input.parentId!=='root' ? `/${resource}/${part(input.parentId)}`:''}/search`
  }
  return query(path,{offset:input.offset,limit:input.limit,...(input.workload==='Teams' ? input.kind==='tabs'?{}:{channelId:requireValue(input.channelId,'a channel'),parentId:input.parentId || (input.kind==='posts' ? '-1':'root')}:{setId})})
}

export function entityPath(sessionId:string,workload:Workload,item:Pick<CartItem,'id'|'ownerId'|'kind'|'channelId'>) {
  const base=ownerBase(sessionId,workload,item.ownerId)
  if(workload==='Exchange') {
    if(!['item','folder'].includes(item.kind))throw new RecoveryError('Choose Exchange messages or folders.')
    return `${base}/${item.kind==='folder' ? 'folders':'items'}/${part(item.id)}`
  }
  if(workload==='Teams') {
    if(!['file','folder','tab'].includes(item.kind))throw new RecoveryError('Only Teams files, folders and tabs can be restored individually.')
    return `${base}/channels/${part(requireValue(item.channelId,'a channel'))}/${item.kind==='tab' ? 'tabs':'files'}/${part(item.id)}`
  }
  const resource=({document:'Documents',folder:'Folders',item:'Items'} as Record<string,string>)[item.kind]
  if(!resource || workload==='OneDrive' && item.kind==='item')throw new RecoveryError('Unsupported document selection.')
  return `${base}/${resource}/${part(item.id)}`
}

export type RestoreGroup={key:string;items:CartItem[];entities:JsonRecord[];path:string;body:JsonRecord}
const take=(object:JsonRecord,keys:string[])=>Object.fromEntries(keys.filter(key=>object[key]!==undefined).map(key=>[key,object[key]]))
export function authPayload(input:RestoreInput) {
  // The selected application is bound when the code is issued.
  // Keep certificate authentication fields out of device-code restore requests.
  if(input.auth.mode==='deviceCode')return {userCode:input.auth.userCode}
  const {mode,...fields}=input.auth,auth:JsonRecord={...fields}
  if(mode!=='certificate'||input.workload!=='Exchange'||!auth.impersonationAccountName)delete auth.impersonationAccountName
  return auth
}
/** Build only documented selected-entity requests. No empty collection can broaden a restore. */
export function restoreGroups(input:RestoreInput,entities:JsonRecord[],targetOneDrive?:JsonRecord):RestoreGroup[] {
  if(!input.items.length || input.items.length!==entities.length)throw new RecoveryError('Choose at least one verified item.')
  const {workload,options:o}=input,auth=authPayload(input)
  if(workload==='Teams' && o.destination!=='original')throw new RecoveryError('Teams recovery supports the original location.')
  if(workload==='Teams' && !o.restoreChangedItems && !o.restoreMissingItems)throw new RecoveryError('Choose missing items, changed items, or both to restore.')
  if(o.destination==='alternate' && workload==='Exchange' && (!o.mailbox || !o.folder))throw new RecoveryError('Enter the target mailbox and folder.')
  // VB365 8.3+ requires at least one category for Exchange restoreTo (KB4809).
  // Default to missing items only; an explicit choice must not broaden the restore.
  const exchangeItems=workload==='Exchange'&&o.destination==='alternate'?{changedItems:o.changedItems??false,deletedItems:o.deletedItems??(o.changedItems===undefined)}:undefined
  if(exchangeItems&&!exchangeItems.changedItems&&!exchangeItems.deletedItems)throw new RecoveryError('Choose missing items, changed items, or both to restore.')
  if(o.destination==='alternate' && workload==='OneDrive' && (!targetOneDrive || !o.folder))throw new RecoveryError('Choose a target OneDrive and folder.')
  if(o.destination==='alternate' && workload==='OneDrive' && targetOneDrive?.id!==o.targetOneDriveId)throw new RecoveryError('The target OneDrive no longer matches the selection. Select it again.',409)
  if(o.destination==='alternate' && workload==='SharePoint' && (!o.siteURL || new URL(o.siteURL).protocol!=='https:'))throw new RecoveryError('Enter the HTTPS target SharePoint site URL.')
  const groups=new Map<string,{items:CartItem[];entities:JsonRecord[]}>(),seen=new Set<string>()
  input.items.forEach((item,index)=>{
    const entity=entities[index]
    if(String(entity.id)!==item.id)throw new RecoveryError('The selected item no longer matches the backup. Refresh and select it again.',409)
    const entityOwner=workload==='OneDrive'?entity.oneDriveId:workload==='SharePoint'?entity.siteId:workload==='Teams'?entity.teamId:undefined
    if(entityOwner && entityOwner!==item.ownerId)throw new RecoveryError('The selected item does not belong to this backed-up object.',409)
    if(workload==='Teams' && (!item.channelId || entity.channelId && entity.channelId!==item.channelId || item.kind!=='tab' && !entity.channelId))throw new RecoveryError('A Teams item does not belong to the selected channel.',409)
    if((entity.isFolder===true || entity.fileType==='Folder') && item.kind!=='folder')throw new RecoveryError('Select the folder as a folder, then review its contents.',409)
    const unique=JSON.stringify([item.ownerId,item.channelId || '',item.kind,item.id]);if(seen.has(unique))return;seen.add(unique)
    // Exchange's folder endpoint accepts one folder; other endpoints accept selected arrays.
    const key=JSON.stringify([item.ownerId,item.channelId || '',item.kind,workload==='Exchange' && item.kind==='folder' ? item.id:''])
    const group=groups.get(key) || {items:[],entities:[]};group.items.push(item);group.entities.push(entity);groups.set(key,group)
  })
  const regional=take(o as JsonRecord,['officeRegion','organizationName'])
  return [...groups.entries()].map(([key,group])=>{
    const item=group.items[0],base=ownerBase(input.sessionId,workload,item.ownerId),alternate=o.destination==='alternate'
    let path:string,body:JsonRecord={...auth}
    if(workload==='Exchange') {
      path=item.kind==='folder' ? `${entityPath(input.sessionId,workload,item)}/${alternate ? 'restoreTo':'restore'}`:`${base}/items/${alternate ? 'restoreTo':'restore'}`
      if(item.kind!=='folder')body.items=group.items.map(row=>({id:row.id}))
      if(alternate)body={...body,...take(o as JsonRecord,['mailbox','folder','casServer','officeRegion','excludeDrafts','excludeDeletedItems','excludeInPlaceHoldItems','excludeLitigationHoldItems']),...exchangeItems,markRestoredAsUnread:o.markRestoredAsUnread??false,...(o.organizationName ? {officeOrganizationName:o.organizationName}:{})}
    }else if(workload==='Teams') {
      if(item.kind==='tab') {path=`${base}/channels/${part(item.channelId!)}/tabs/restore`;body={...body,tabs:group.entities.map(row=>take(row,['id','channelId','displayName','contentUrl','type','teamId'])),restoreChangedTabs:o.restoreChangedItems,restoreMissingTabs:o.restoreMissingItems}}
      else {path=`${base}/files/restore`;body={...body,files:group.entities.map(row=>take(row,['id','channelId','name','sizeBytes','version','uiVersion','modified','modifiedBy','teamId','fileType'])),restoreChangedItems:o.restoreChangedItems,restoreMissingItems:o.restoreMissingItems,fileVersion:o.documentVersion}}
    }else {
      const kind=item.kind==='folder' ? 'folders':item.kind==='item' ? 'items':'documents',resource=kind[0].toUpperCase()+kind.slice(1)
      path=`${base}/${resource}/${alternate ? workload==='OneDrive' ? 'copyTo':'restoreTo':'restore'}`
      const keys=['id','name','createdBy','creationTime','modifiedBy','modificationTime','version','versionId','isFolder',...(workload==='OneDrive'?['oneDriveId',...(kind==='documents'?['sizeBytes','inheritedPermissions']:[])]:['siteId',...(kind==='documents'?['sizeBytes']:kind==='items'?['title']:['type'])])]
      body[kind]=group.entities.map(row=>take(row,keys))
      if(workload==='OneDrive')body={...body,...regional,...(alternate ? {onedrive:take(targetOneDrive!,['id','name','url']),folder:o.folder,documentVersion:o.documentVersion,documentLastVersionAction:o.documentLastVersionAction,...take(o as JsonRecord,['changedItems','deletedItems']),...(kind==='folders' ? {restorePermissions:o.restorePermissions,sendSharedLinksNotification:o.sendSharedLinksNotification}:{})}:{documentAction:o.documentAction})}
      else body={...body,...take(o as JsonRecord,['list']),documentVersion:o.documentVersion,documentLastVersionAction:o.documentLastVersionAction,sendSharedLinksNotification:o.sendSharedLinksNotification,...(alternate ? {...regional,siteURL:o.siteURL}:{restorePermissions:o.restorePermissions})}
    }
    return {...group,key,path,body}
  })
}
