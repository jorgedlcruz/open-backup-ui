// Open Backup UI v1.0.2
export type RecoveryDestination={platform:string;manager:string;folder:string;name:string}
export function sameRecoveryDestination(a:RecoveryDestination,b:RecoveryDestination){
  const same=(x:string,y:string)=>x.trim().toLowerCase()===y.trim().toLowerCase()
  return same(a.platform,b.platform)&&same(a.name,b.name)&&(!a.manager||!b.manager||same(a.manager,b.manager))&&(!a.folder||!b.folder||same(a.folder,b.folder))
}
