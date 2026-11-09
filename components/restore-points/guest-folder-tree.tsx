'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Folder, HardDrive, Loader2 } from 'lucide-react'
import { veeamApi } from '@/lib/api/veeam-client'
import { guestItemPath, type GuestDirectory } from '@/lib/restore-points/workflow'
import { isBelow, samePath } from '@/lib/restore-points/guest-workspace'
import { useRecoveryPresentation } from './use-presentation'
import styles from './guest-files.module.css'

type Props = { sessionId: string; sourceKey: string; root: string; path: string; separator: string; navigate: (path: string) => void }

export function GuestFolderTree(props: Props) {
  const { t } = useRecoveryPresentation()
  return <nav className={styles.tree} aria-label={t('Folder tree')}><h4>{t('Folders')}</h4>
    <Branch {...props} folder={props.root} name={t('Guest file system')} isRoot />
  </nav>
}

function Branch(props: Props & { folder: string; name: string; isRoot?: boolean; drive?: boolean }) {
  const { sessionId, sourceKey, root, path, separator, navigate, folder, name, isRoot, drive } = props
  const { t, diagnostic } = useRecoveryPresentation()
  const [open, setOpen] = useState(!!isRoot || isBelow(path, folder, separator))
  const [skip, setSkip] = useState(0)
  const [pages, setPages] = useState<GuestDirectory[]>([])
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const loaded = pages.some(page => page.pagination.skip === skip)
  useEffect(() => {
    if (samePath(path, folder, separator) || isBelow(path, folder, separator)) setOpen(true)
  }, [path, folder, separator])
  useEffect(() => {
    if (!open || loaded) return
    const controller = new AbortController()
    veeamApi.browseGuestFiles(sessionId, sourceKey, folder, skip, controller.signal, true)
      .then(page => { if (!controller.signal.aborted) { setPages(items => [...items, page]); setError('') } })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : t('Recovery request failed.')) })
    return () => controller.abort()
  }, [open, loaded, folder, sessionId, sourceKey, skip, retry, t])
  const active = samePath(path, folder, separator)
  const last = pages.at(-1)?.pagination
  const children = pages.flatMap(page => page.items.filter(item => item.type === 'Folder' || item.type === 'Drive').map(item => ({
    path: guestItemPath(item, page), name: item.displayName || item.name, drive: item.type === 'Drive',
  }))).filter(child => !samePath(child.path, folder, separator))
  return <div>
    <div className={styles.node} data-active={active}>
      <button type="button" className={styles.chevron} aria-label={t(open ? 'Collapse {name}' : 'Expand {name}', {name})} aria-expanded={open}
        onClick={() => setOpen(!open)}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
      <button type="button" aria-current={active ? 'location' : undefined} onClick={() => { setOpen(true); navigate(folder) }}>
        {drive || isRoot ? <HardDrive size={14} /> : <Folder size={14} />}<span>{name}</span></button>
    </div>
    {open && <div className={styles.children}>
      {children.map(child => <Branch key={child.path} sessionId={sessionId} sourceKey={sourceKey} root={root} path={path} separator={separator} navigate={navigate}
        folder={child.path} name={child.name} drive={child.drive}/>)}
      {!loaded && !error && <Loader2 size={14} aria-label={t('Loading…')} className="animate-spin" />}
      {error && <button className={styles.link} type="button" title={diagnostic(error)} onClick={() => { setError(''); setRetry(value => value + 1) }}>{t('Retry')}</button>}
      {loaded && last && last.count > 0 && last.skip + last.count < last.total && <button type="button" className={styles.link} onClick={() => setSkip(last.skip + last.count)}>{t('Load more')}</button>}
    </div>}
  </div>
}
