// Open Backup UI v1.3.0
import type { RecoveryItem } from './model'

export type RecoveryVisualType =
  | 'mailbox' | 'archive-mailbox' | 'public-mailbox' | 'drive' | 'site' | 'subsite' | 'team'
  | 'channel' | 'private-channel' | 'shared-channel' | 'post' | 'tab'
  | 'folder' | 'library-folder' | 'list-folder' | 'library' | 'list' | 'list-item'
  | 'message' | 'appointment' | 'contact' | 'contact-group' | 'discussion' | 'journal' | 'note' | 'task' | 'exchange-item'
  | 'calendar-folder' | 'contacts-folder' | 'tasks-folder' | 'notes-folder' | 'journal-folder'
  | 'inbox-folder' | 'outbox-folder' | 'sent-folder' | 'deleted-folder' | 'drafts-folder'
  | 'permanently-deleted-folder' | 'purges-folder' | 'holds-folder' | 'conflicts-folder'
  | 'sync-folder' | 'local-failures-folder' | 'server-failures-folder' | 'junk-folder' | 'versions-folder' | 'teams-messages-folder'
  | 'document' | 'text-document' | 'spreadsheet' | 'presentation' | 'pdf' | 'image' | 'video' | 'audio' | 'archive' | 'code' | 'web-page'

export type IconItem = Pick<RecoveryItem, 'kind' | 'workload' | 'isFolder'> & Partial<Pick<RecoveryItem, 'name' | 'itemClass' | 'raw' | 'parentId'>>

const normalized = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : ''
const folderTypes: Record<string, RecoveryVisualType> = {
  appointment: 'calendar-folder', contact: 'contacts-folder', task: 'tasks-folder',
  stickynote: 'notes-folder', journal: 'journal-folder',
}
const folderCategories: Record<string, RecoveryVisualType> = {
  inbox: 'inbox-folder', outbox: 'outbox-folder', sent: 'sent-folder', deleted: 'deleted-folder', drafts: 'drafts-folder',
  permanentlydeleteditems: 'permanently-deleted-folder', purges: 'purges-folder', discoveryholds: 'holds-folder',
  conflicts: 'conflicts-folder', syncissues: 'sync-folder', localfailures: 'local-failures-folder',
  serverfailures: 'server-failures-folder', junk: 'junk-folder', versions: 'versions-folder', teamsmessagesdata: 'teams-messages-folder',
}
const fileTypes: Record<string, RecoveryVisualType> = {
  doc: 'text-document', docx: 'text-document', docm: 'text-document', dot: 'text-document', dotx: 'text-document', odt: 'text-document', rtf: 'text-document', txt: 'text-document', md: 'text-document',
  xls: 'spreadsheet', xlsx: 'spreadsheet', xlsm: 'spreadsheet', xlsb: 'spreadsheet', ods: 'spreadsheet', csv: 'spreadsheet', tsv: 'spreadsheet',
  ppt: 'presentation', pptx: 'presentation', pptm: 'presentation', pps: 'presentation', ppsx: 'presentation', odp: 'presentation',
  pdf: 'pdf', jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', svg: 'image', tif: 'image', tiff: 'image', bmp: 'image', heic: 'image', avif: 'image',
  mp4: 'video', mov: 'video', avi: 'video', mkv: 'video', webm: 'video', wmv: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', flac: 'audio', wma: 'audio',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', bz2: 'archive', cab: 'archive',
  js: 'code', ts: 'code', jsx: 'code', tsx: 'code', json: 'code', xml: 'code', css: 'code', py: 'code', ps1: 'code', sh: 'code', sql: 'code', yaml: 'code', yml: 'code',
  aspx: 'web-page', asp: 'web-page', html: 'web-page', htm: 'web-page', url: 'web-page',
}

function fileType(name: unknown): RecoveryVisualType {
  const value = normalized(name)
  const extension = /\.([a-z0-9]+)$/.exec(value)?.[1]
  return extension ? fileTypes[extension] || 'document' : 'document'
}

/** Uses the API's resource kind and discriminators before considering a file extension.
 * Exchange itemClass families follow Microsoft's MS-OXPROPS common message classes.
 * Names are never used to guess a mailbox folder category (they can be localized or renamed).
 */
export function recoveryItemVisualType(item: IconItem): RecoveryVisualType {
  const raw = item.raw || {}
  if (item.kind === 'owner') {
    if (item.workload === 'Exchange') return raw.isArchive === true ? 'archive-mailbox' : raw.isPublic === true ? 'public-mailbox' : 'mailbox'
    if (item.workload === 'OneDrive') return 'drive'
    if (item.workload === 'Teams') return 'team'
    return item.parentId && item.parentId !== 'root' ? 'subsite' : 'site'
  }
  if (item.kind === 'library') return 'library'
  if (item.kind === 'list') return 'list'
  if (item.kind === 'channel') return normalized(raw.type) === 'private' ? 'private-channel' : normalized(raw.type) === 'shared' ? 'shared-channel' : 'channel'
  if (item.kind === 'post') return 'post'
  if (item.kind === 'tab') return 'tab'

  const folderType = normalized(raw.type)
  if (item.isFolder || item.kind === 'folder' || raw.isFolder === true || raw.fileType === 'Folder' || item.workload === 'SharePoint' && ['listfolder', 'libraryfolder'].includes(folderType)) {
    if (item.workload === 'Exchange') return folderTypes[folderType] || folderCategories[normalized(raw.category)] || 'folder'
    if (item.workload === 'SharePoint') return folderType === 'listfolder' ? 'list-folder' : folderType === 'libraryfolder' ? 'library-folder' : 'folder'
    return 'folder'
  }
  if (item.workload === 'Exchange') {
    const itemClass = normalized(item.itemClass || raw.itemClass)
    const family = (prefix: string) => itemClass === prefix || itemClass.startsWith(prefix + '.')
    if (family('ipm.appointment') || family('ipm.schedule.meeting')) return 'appointment'
    if (family('ipm.distlist')) return 'contact-group'
    if (family('ipm.contact')) return 'contact'
    if (family('ipm.post')) return 'discussion'
    if (family('ipm.activity')) return 'journal'
    if (family('ipm.stickynote')) return 'note'
    if (family('ipm.task') || family('ipm.taskrequest')) return 'task'
    if (family('ipm.note') || family('report.ipm.note')) return 'message'
    // Custom item classes remain a neutral Exchange item rather than a guessed email.
    return 'exchange-item'
  }
  if (item.workload === 'SharePoint' && item.kind === 'item') return 'list-item'
  return fileType(item.name || raw.name)
}
