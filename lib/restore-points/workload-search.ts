// Open Backup UI v1.0.2
import type {RecoveryObject} from './recovery-picker'

export const workloadFilters={all:'All',vm:'Virtual machines',physical:'Computers',unstructured:'Unstructured data'} as const
export type WorkloadFilter=keyof typeof workloadFilters

export function searchableText(value:string) {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s*[\\/]\s*/g,'/')
}

// Older VBR inventory can only distinguish homonyms by the suffix of their
// backup-object UUID. Keep that disambiguator on screen, outside text search.
function inventoryPath(object:RecoveryObject) {
  if(object.displayPath)return object.displayPath
  const label=object.distinguishingLocation||''
  const pieces=label.split(' · ')
  const last=pieces.at(-1)
  if(last&&last.length>=8&&object.objectId.toLowerCase().endsWith(last.toLowerCase()))pieces.pop()
  return pieces.join(' · ')
}

export function workloadSearchText(object:RecoveryObject){
  const name=object.name.toLowerCase()===object.objectId.toLowerCase()?'':object.name
  return searchableText(name)+'\n'+searchableText(inventoryPath(object))
}
export function matchesWorkloadSearch(object:RecoveryObject,query:string){
  return workloadSearchText(object).includes(searchableText(query))
}

export function matchesWorkloadType(object:RecoveryObject,filter:WorkloadFilter){
  const type=object.workloadType||'vm'
  return filter==='all'||(filter==='unstructured'?type==='nas'||type==='object':type===filter)
}
