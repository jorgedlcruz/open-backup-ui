// Open Backup UI v1.3.0
import type { RecoveryItem } from './model'
import { recoveryItemVisualType } from './item-type'

const types: Record<string,string> = {
  pdf:'application/pdf', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp',
  txt:'text/plain', log:'text/plain', csv:'text/plain', md:'text/plain', json:'text/plain',
}
export const previewLimit = 16 * 1024 * 1024

export function previewMedia(name:string) {
  const extension=/\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase()
  return extension && Object.hasOwn(types,extension) ? types[extension] : undefined
}

export function availableContent(item:RecoveryItem) {
  if (!item.ownerId || item.isFolder || !item.selectable) return false
  if (item.workload==='Exchange') return recoveryItemVisualType(item)==='message'
  return item.kind==='document' && (item.workload==='OneDrive' || item.workload==='SharePoint')
    || item.workload==='Teams' && item.kind==='file' && !!item.channelId
}

export function matchesPreviewMedia(bytes:Uint8Array, media:string) {
  const prefix=(...values:number[])=>values.every((v,i)=>bytes[i]===v)
  const ascii=(start:number,len:number)=>String.fromCharCode(...bytes.subarray(start,start+len))
  switch(media) {
    case 'image/png':return prefix(137,80,78,71,13,10,26,10)
    case 'image/jpeg':return prefix(255,216,255)
    case 'image/gif':return ['GIF87a','GIF89a'].includes(ascii(0,6))
    case 'image/webp':return ascii(0,4)==='RIFF' && ascii(8,4)==='WEBP'
    case 'application/pdf':return ascii(0,5)==='%PDF-'
    case 'text/plain':return !bytes.subarray(0,4096).includes(0) || prefix(255,254) || prefix(254,255)
    default:return false
  }
}
