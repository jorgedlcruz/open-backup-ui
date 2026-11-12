// Open Backup UI v1.2.0
import { ContactRound, File, Folder, FolderCog, FolderGit2, FolderTree, Globe2, MapPin, Monitor, Network, Printer, Router, ScrollText, Server, Settings2, ShieldUser, UserRound, UserRoundCog, UsersRound } from 'lucide-react'
import type { AdEntry } from '@/lib/restore-points/ad-client'
import { directoryIconKind } from '@/lib/restore-points/ad-item-icon'
import styles from './active-directory.module.css'

const icons = {
  domain: Network, folder: Folder, unit: FolderTree, user: UserRound, group: UsersRound,
  computer: Monitor, contact: ContactRound, serviceAccount: UserRoundCog, principal: ShieldUser,
  policy: ScrollText, policyFolder: FolderCog, dns: Globe2, configuration: Settings2,
  dfs: FolderGit2, printer: Printer, server: Server, site: MapPin, subnet: Router, object: File,
}

export function DirectoryObjectIcon({entry}: {entry: Pick<AdEntry, 'type' | 'itemType' | 'containerType'>}) {
  const kind = directoryIconKind(entry), Icon = icons[kind]
  return <Icon className={styles.itemIcon} size={18} strokeWidth={1.7} aria-hidden="true" data-directory-kind={kind}/>
}
