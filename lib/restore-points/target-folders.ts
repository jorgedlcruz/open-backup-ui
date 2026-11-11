// Open Backup UI v1.2.0
export type TargetBrowseSession={browseSessionId:string;browseKey:string;serverId:string;serverName?:string;pathSeparator:string;rootPath:string;expiresAt:string}
export type TargetFolder={name:string;path:string;type:'Drive'|'Folder';isSymbolicLink:boolean}
export type TargetFolderPage={path:string;items:TargetFolder[];total:number|null;count:number;skip:number}

/** Compare native paths without changing their spelling in a request or payload. */
export function targetPathWithin(path:string,root:string,separator:string){
  if(!['/','\\'].includes(separator)||/[\u0000-\u001f]/.test(path)||/[\u0000-\u001f]/.test(root))return false
  if(path.split(/[\\/]/).some(part=>part==='.'||part==='..'))return false
  if(path.startsWith(separator+separator)&&!root.startsWith(separator+separator))return false
  if(!root)return !path||(separator==='\\'?/^[a-z]:\\/i.test(path):path.startsWith('/'))
  const p=separator==='\\'?path.toLowerCase():path,r=separator==='\\'?root.toLowerCase():root
  return p===r||p.startsWith(r)&&(r.endsWith(separator)||p.slice(r.length).startsWith(separator))
}
export function targetFolderPath(item:{itemType:string;fullName?:string|null;name:string},separator:string){
  if(item.itemType==='Folder')return item.fullName??undefined
  if(item.itemType!=='Drive')return undefined
  if(item.fullName)return item.fullName
  return separator==='\\'&&/^[a-z]:$/i.test(item.name)?item.name+separator:item.name
}
