// Open Backup UI v1.3.0
import type { ReactNode } from 'react'
import { recoveryItemVisualType, type IconItem, type RecoveryVisualType } from '../../lib/vbm-recovery/item-type'

type Mark = 'calendar' | 'person' | 'people' | 'check' | 'note' | 'journal' | 'down' | 'up' | 'send' | 'trash' | 'pencil' | 'cross' | 'purge' | 'lock' | 'conflict' | 'sync' | 'device' | 'server' | 'shield' | 'history' | 'chat' | 'lines' | 'table' | 'bars' | 'pdf' | 'picture' | 'play' | 'music' | 'zip' | 'code' | 'web' | 'record'

// Original small-grid glyphs: each retains a distinct silhouette without relying on color.
function MarkShape({mark}: {mark: Mark}) {
  switch (mark) {
    case 'calendar': return <><path d="M2 4h12v10H2zM2 7h12M5 2v4M11 2v4"/><path d="M5 10h2m3 0h1M5 12h2"/></>
    case 'person': return <><circle cx="8" cy="4.5" r="2.5"/><path d="M3 14v-2a5 5 0 0 1 10 0v2"/></>
    case 'people': return <><circle cx="5.5" cy="4.5" r="2"/><path d="M1 13v-1a4.5 4.5 0 0 1 9 0v1M10 3a2 2 0 0 1 0 4m2 2a3 3 0 0 1 3 3v1"/></>
    case 'check': return <path d="m2 8 4 4 8-9"/>
    case 'note': return <><path d="M2 2h12v8l-4 4H2zM10 14v-4h4"/><path d="M5 5h6M5 8h3"/></>
    case 'journal': return <><path d="M3 2h10v12H3zM6 2v12M1 5h4M1 10h4M8 5h3M8 8h3"/></>
    case 'down': return <path d="M8 1v10m-4-4 4 4 4-4M2 11v3h12v-3"/>
    case 'up': return <path d="M8 11V1M4 5l4-4 4 4M2 11v3h12v-3"/>
    case 'send': return <path d="m1 7 14-6-5 14-3-5-6-3Zm6 3 8-9"/>
    case 'trash': return <path d="M2 4h12M5 4V2h6v2M4 4l1 10h6l1-10M7 7v4m2-4v4"/>
    case 'pencil': return <path d="m3 10 8-8 3 3-8 8-4 1 1-4Zm6-6 3 3"/>
    case 'cross': return <path d="m3 3 10 10M13 3 3 13"/>
    case 'purge': return <><path d="M2 3h12M4 3l1 11h6l1-11M6 3V1h4v2"/><path d="m6 6 4 5m0-5-4 5"/></>
    case 'lock': return <><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0v2M8 10v1"/></>
    case 'conflict': return <path d="M2 2h3l6 12h3M2 14h3l2-4m2-4 2-4h3M8 7v1"/>
    case 'sync': return <><path d="M13 6A5.5 5.5 0 0 0 3 4L1 6m0-4v4h4M3 10a5.5 5.5 0 0 0 10 2l2-2m0 4v-4h-4"/></>
    case 'device': return <><path d="M1 2h14v9H1zM5 14h6M8 11v3M8 4v3m0 2h.01"/></>
    case 'server': return <><path d="M2 2h12v5H2zM2 9h12v5H2zM4 4.5h.01M4 11.5h.01M9 3.5v2M9 10.5v2"/></>
    case 'shield': return <><path d="m8 1 6 2v5c0 3-3 5-6 7-3-2-6-4-6-7V3z"/><path d="M8 5v4m0 3h.01"/></>
    case 'history': return <><path d="M2 5a6 6 0 1 1 0 6M1 1v4h4M8 4v4l3 2"/></>
    case 'chat': return <><path d="M2 2h12v9H8l-5 3v-3H2zM5 5h6M5 8h3"/></>
    case 'lines': return <path d="M2 3h12M2 7h12M2 11h8"/>
    case 'table': return <path d="M1 2h14v12H1zM1 6h14M1 10h14M6 2v12"/>
    case 'bars': return <><path d="M1 1h14v10H1zM8 11v4m-3 0 3-4 3 4M4 8V6m4 2V3m4 5V5"/></>
    case 'pdf': return <><path d="M4 13 8 2l4 11M5 10h6"/><path d="M1 12c5-4 8-5 14-2"/></>
    case 'picture': return <><path d="M1 2h14v12H1zM1 12l4-5 4 4 2-2 4 4"/><circle cx="11" cy="5" r="1"/></>
    case 'play': return <path d="m4 2 10 6-10 6z"/>
    case 'music': return <><path d="M6 12V3l8-2v9M6 6l8-2"/><ellipse cx="3.5" cy="12.5" rx="2.5" ry="1.5"/><ellipse cx="11.5" cy="10.5" rx="2.5" ry="1.5"/></>
    case 'zip': return <><path d="M6 1h4M6 4h4M6 7h4M6 10h4M5 10h6v4H5z"/></>
    case 'code': return <path d="m4 3-3 5 3 5m8-10 3 5-3 5M9 1 7 15"/>
    case 'web': return <><circle cx="8" cy="8" r="6.5"/><ellipse cx="8" cy="8" rx="2.5" ry="6.5"/><path d="M2 6h12M2 10h12"/></>
    case 'record': return <><path d="M2 2h12v12H2zM6 2v12M6 6h8M6 10h8M3 4h.01M3 8h.01M3 12h.01"/></>
  }
}

function FolderGlyph({mark}: {mark?: Mark}) {
  return <><path d="M3 5.5h6l2 2h10v11.75A1.75 1.75 0 0 1 19.25 21H4.75A1.75 1.75 0 0 1 3 19.25z"/>{mark ? <g transform="translate(7 10) scale(.64)"><MarkShape mark={mark}/></g> : <path d="M3 10h18"/>}</>
}
function DocumentGlyph({mark}: {mark?: Mark}) {
  return <><path d="M5 2.5h9l5 5v14H5zM14 2.5v5h5"/>{mark ? <g transform="translate(6.5 9) scale(.7)"><MarkShape mark={mark}/></g> : <path d="M8 12h8M8 16h6"/>}</>
}
function ContentGlyph({mark}: {mark: Mark}) {
  return <g transform="translate(3 3) scale(1.15)"><MarkShape mark={mark}/></g>
}
function LibraryGlyph({list=false}: {list?: boolean}) {
  return <><path d="M3 5h18v16H3zM6 2h12M4.5 3.5h15M3 9h18"/>{list ? <path d="M6 12.5h.01m3 0h9M6 16.5h.01m3 0h9"/> : <><path d="M7 12v6m5-6v6m4-6 1 6"/><path d="M6 18h12"/></>}</>
}

const folderMarks: Partial<Record<RecoveryVisualType, Mark>> = {
  'library-folder': 'lines', 'list-folder': 'record', 'calendar-folder': 'calendar', 'contacts-folder': 'person',
  'tasks-folder': 'check', 'notes-folder': 'note', 'journal-folder': 'journal', 'inbox-folder': 'down', 'outbox-folder': 'up',
  'sent-folder': 'send', 'deleted-folder': 'trash', 'drafts-folder': 'pencil', 'permanently-deleted-folder': 'cross',
  'purges-folder': 'purge', 'holds-folder': 'lock', 'conflicts-folder': 'conflict', 'sync-folder': 'sync',
  'local-failures-folder': 'device', 'server-failures-folder': 'server', 'junk-folder': 'shield', 'versions-folder': 'history', 'teams-messages-folder': 'chat',
}
const documentMarks: Partial<Record<RecoveryVisualType, Mark>> = {
  'text-document': 'lines', spreadsheet: 'table', presentation: 'bars', pdf: 'pdf', image: 'picture', video: 'play', audio: 'music', archive: 'zip', code: 'code', 'web-page': 'web',
}
const itemMarks: Partial<Record<RecoveryVisualType, Mark>> = {
  appointment: 'calendar', contact: 'person', 'contact-group': 'people', discussion: 'chat', journal: 'journal', note: 'note', 'list-item': 'record',
}

function glyph(type: RecoveryVisualType): ReactNode {
  if (folderMarks[type]) return <FolderGlyph mark={folderMarks[type]}/>
  if (documentMarks[type]) return <DocumentGlyph mark={documentMarks[type]}/>
  if (itemMarks[type]) return <ContentGlyph mark={itemMarks[type]!}/>
  switch (type) {
    case 'folder': return <FolderGlyph/>
    case 'document': return <DocumentGlyph/>
    case 'mailbox': return <><path d="M3 8.5 6 3h12l3 5.5v12H3zM3 8.5h5l1.5 3h5L16 8.5h5M7 16h10"/></>
    case 'archive-mailbox': return <><path d="M3 3h18v5H3zM5 8v13h14V8M9 12h6"/><path d="M10 15h4v3h-4z"/></>
    case 'public-mailbox': return <><path d="M3 8h18v12H3zM3 8l9 7 9-7M5 4h14M8 1h8"/></>
    case 'drive': return <><path d="M4 12.5 6 5h12l2 7.5v7H4zM4 12.5h16M7 16.5h.01m3 0h.01M8 8h8"/></>
    case 'site': return <><path d="M3 4h18v16H3zM3 9h18M8 9v11M6 6.5h.01m3 0h.01M11 12h7v5h-7z"/></>
    case 'subsite': return <><path d="M3 2h6v6H3zM6 8v8h5M13 11h8v10h-8zM13 14h8"/></>
    case 'team': return <><circle cx="12" cy="6" r="3"/><path d="M6 21v-5a6 6 0 0 1 12 0v5M4 5a2.5 2.5 0 0 0 0 5m16-5a2.5 2.5 0 0 1 0 5M2 21v-6a3 3 0 0 1 2-3m18 9v-6a3 3 0 0 0-2-3"/></>
    case 'channel': return <><path d="m10 3-3 18M17 3l-3 18M3 8h18M2 16h18"/></>
    case 'private-channel': return <><path d="m9 3-3 18M15 3l-1 6M2 8h16M1 16h8"/><rect x="12" y="14" width="10" height="8" rx="1.5"/><path d="M14.5 14v-2a2.5 2.5 0 0 1 5 0v2"/></>
    case 'shared-channel': return <><path d="m9 2-3 18M16 2l-1 6M2 7h17M1 15h8"/><path d="M12 13h9m-3-3 3 3-3 3m3 4h-9m3-3-3 3 3 3"/></>
    case 'post': return <><path d="M3 3h18v13H11l-6 5v-5H3zM7 7h10M7 11h7"/><path d="m16 19 3 2v-2"/></>
    case 'tab': return <><path d="M3 4h8l2 3h8v14H3zM3 11h18M7 8h2M7 15h10M7 18h6"/></>
    case 'library': return <LibraryGlyph/>
    case 'list': return <LibraryGlyph list/>
    case 'message': return <><path d="M3 5h18v14H3zM3 5l9 8 9-8M3 19l6-7m12 7-6-7"/></>
    case 'task': return <><path d="M8 4H4v17h16V4h-4M8 2h8v5H8z"/><path d="m8 14 3 3 5-6"/></>
    case 'exchange-item': return <><path d="M5 3h14v18H5zM8 7h8M8 11h5"/><path d="m10 15 2-2 2 2-2 2z"/></>
    default: return <DocumentGlyph/>
  }
}

/** Decorative, theme-inherited icons; the adjacent item name and type remain the accessible label. */
export function ItemIcon({item,size=17,className}: {item: IconItem;size?: number;className?: string}) {
  const type = recoveryItemVisualType(item)
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className} data-recovery-icon={type} style={{flexShrink:0,verticalAlign:'middle'}}>{glyph(type)}</svg>
}
