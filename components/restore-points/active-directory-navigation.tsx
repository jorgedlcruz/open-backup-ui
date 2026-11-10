'use client'
// Open Backup UI v1.2.0

import { useState } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderTree, Network } from 'lucide-react'
import type { AdEntry } from '@/lib/restore-points/ad-client'
import { useRecoveryPresentation } from './use-presentation'
import browse from './sql-browse-workspace.module.css'
import styles from './active-directory.module.css'

export function directoryPathKey(path: AdEntry[]) {
  return JSON.stringify(path.map(row => row.id))
}

type Props = {
  path: AdEntry[]
  branches: ReadonlyMap<string, AdEntry[]>
  navigate: (path: AdEntry[]) => void
}

export function DirectoryNavigation({path, branches, navigate}: Props) {
  const {t} = useRecoveryPresentation()
  const [folded, setFolded] = useState<{location:string; branch:string}>()
  const location = directoryPathKey(path)

  function open(next: AdEntry[]) {
    setFolded(undefined)
    navigate(next)
  }

  function children(parents: AdEntry[]) {
    const rows = branches.get(directoryPathKey(parents)) ?? []
    const active = path[parents.length]
    // A breadcrumb stays reachable while its original grid page is refreshing.
    const visible = active && !rows.some(row => row.id === active.id) ? [...rows, active] : rows
    if (!visible.length) return null

    return <ul>{visible.map(row => {
      const next = [...parents, row]
      const key = directoryPathKey(next)
      const onPath = active?.id === row.id
      const expanded = onPath && !(folded?.location === location && folded.branch === key)
      const current = onPath && path.length === next.length
      const knownEmpty = branches.get(key)?.length === 0
      const Icon = row.type === 'domain' ? Network : Folder
      return <li key={row.id}>
        <div className={browse.treeRow} data-current={current || undefined}>
          {knownEmpty ? <span className={browse.spacer}/> : <button type="button" className={browse.disclose}
            aria-label={t(expanded ? 'Collapse {name}' : 'Expand {name}', {name:row.name})}
            aria-expanded={expanded} onClick={() => {
              if (onPath) setFolded(expanded ? {location,branch:key} : undefined)
              else open(next)
            }}>
            {expanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
          </button>}
          <button type="button" className={browse.node} aria-current={current ? 'location' : undefined}
            title={row.name} onClick={() => open(next)}>
            <Icon size={15}/><span>{row.name}</span>
          </button>
        </div>
        {expanded && children(next)}
      </li>
    })}</ul>
  }

  return <nav className={browse.tree} aria-label={t('Domains')}>
    <h4><button className={styles.domainRoot} type="button" aria-current={!path.length ? 'location' : undefined} onClick={() => open([])}>
      <FolderTree size={15}/>{t('Domains')}
    </button></h4>
    {children([])}
  </nav>
}
