'use client'

import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { Check, ChevronRight, File, Folder, FolderOpen, HardDrive, Loader2, Search, ShoppingCart, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { veeamApi } from '@/lib/api/veeam-client'
import { guestItemPath, type GuestDirectory, type GuestTask } from '@/lib/restore-points/workflow'
import { addToCart, guestCrumbs, isBelow, isTaskRunning, samePath, searchHasResults, type CartEntry, type GuestWorkspace } from '@/lib/restore-points/guest-workspace'
import { GuestFolderTree } from './guest-folder-tree'
import { GuestDownloadPanel } from './guest-download'
import { useRecoveryPresentation } from './use-presentation'
import styles from './guest-files.module.css'

type Props = {
  sessionId: string; sourceKey: string; workspace: GuestWorkspace; setWorkspace: Dispatch<SetStateAction<GuestWorkspace>>
  restoreDisabled: boolean; onRestore: () => void
}

export function GuestFileExplorer({ sessionId, sourceKey, workspace, setWorkspace, restoreDisabled, onRestore }: Props) {
  const { t, diagnostic, size, label } = useRecoveryPresentation()
  const { path, search, cart } = workspace
  const [location, setLocation] = useState<{ root: string; separator: string }>()
  const [mode, setMode] = useState<'folder' | 'search'>(isTaskRunning(search) || searchHasResults(search) ? 'search' : 'folder')
  const [query, setQuery] = useState(search?.query || '')
  const [recursive, setRecursive] = useState(search?.recursive ?? true)
  const [showCart, setShowCart] = useState(false)
  const [skip, setSkip] = useState(0)
  const [directory, setDirectory] = useState<GuestDirectory>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pollError, setPollError] = useState('')
  const [revision, setRevision] = useState(0)
  const lock = useRef(false)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const searchId = search?.id
  const searchKey = search?.searchKey
  const running = isTaskRunning(search)
  const resultsReady = searchHasResults(search)
  const root = location?.root ?? ''
  const separator = location?.separator ?? (path?.startsWith('/') ? '/' : '\\')
  const currentPath = path ?? root
  const currentSearch = mode === 'search' && searchId && searchKey
  const canLoad = !currentSearch || resultsReady

  useEffect(() => {
    if (!searchId || !searchKey || !running) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const status = await veeamApi.guestSearchStatus(sessionId, sourceKey, {id: searchId!, searchKey: searchKey!}, controller.signal)
        if (controller.signal.aborted) return
        setPollError('')
        setWorkspace(current => current.search?.id === searchId && current.search ? { ...current, search: { ...current.search, ...status, id: searchId! } } : current)
        if (!isTaskRunning(status)) {
          if (!searchHasResults(status)) { setMode('folder'); setSkip(0) }
          return
        }
      } catch (err) { if (!controller.signal.aborted) setPollError(err instanceof Error ? err.message : t('Recovery request failed.')) }
      if (!controller.signal.aborted) timer = setTimeout(poll, 3000)
    }
    timer = setTimeout(poll, 1200)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [running, searchId, searchKey, sessionId, sourceKey, setWorkspace, t])

  useEffect(() => {
    const controller = new AbortController()
    setDirectory(undefined)
    setError('')
    setLoading(!!canLoad)
    if (!canLoad) return
    const work = currentSearch
      ? veeamApi.guestSearchResults(sessionId, sourceKey, {id: searchId!, searchKey: searchKey!}, skip, controller.signal)
      : veeamApi.browseGuestFiles(sessionId, sourceKey, path, skip, controller.signal)
    work.then(page => {
      if (controller.signal.aborted) return
      setDirectory(page)
      setLocation({ root: page.guestOs === 'Linux' ? '/' : '', separator: page.pathSeparator })
    }).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : t('Recovery request failed.')) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [canLoad, currentSearch, searchId, searchKey, path, skip, sessionId, sourceKey, revision, t])

  function navigate(next?: string) {
    setMode('folder')
    setSkip(0)
    setWorkspace(current => ({ ...current, path: next }))
  }
  async function start(event: FormEvent) {
    event.preventDefault()
    if (!query.trim() || lock.current || running || !location) return
    lock.current = true
    setBusy(true)
    setError('')
    setPollError('')
    try {
      const pattern = query.trim()
      const task = await veeamApi.startGuestSearch(sessionId, sourceKey, currentPath, pattern, recursive)
      // The user may navigate away while VBR creates the task.
      if (active.current) { setSkip(0); setMode('search') }
      setWorkspace(current => ({ ...current, search: { ...task, query: pattern, path: currentPath, recursive } }))
    } catch (err) { if (active.current) setError(err instanceof Error ? err.message : t('Recovery request failed.')) }
    finally { lock.current = false; if (active.current) setBusy(false) }
  }
  async function stop() {
    if (!search || lock.current) return
    lock.current = true
    setBusy(true)
    try {
      const status: GuestTask = await veeamApi.stopGuestSearch(sessionId, sourceKey, search)
      setWorkspace(current => current.search?.id === search.id && current.search ? { ...current, search: { ...current.search, ...status, id: search.id } } : current)
    } catch (err) { if (active.current) setError(err instanceof Error ? err.message : t('Recovery request failed.')) }
    finally { lock.current = false; if (active.current) setBusy(false) }
  }
  function remove(itemPath: string) {
    setWorkspace(current => ({ ...current, cart: current.cart.filter(entry => !samePath(entry.path, itemPath, separator)) }))
  }
  function add(entry: CartEntry) {
    setWorkspace(current => ({ ...current, cart: addToCart(current.cart, entry, separator) }))
  }

  return <div className={styles.explorer}>
    <form className={styles.searchForm} onSubmit={start}>
      <label className={styles.searchBox}><Search size={16} /><Input aria-label={t('Search guest files')} placeholder={t('File name or wildcard, e.g. *.log')} value={query} maxLength={1024}
        onChange={event => setQuery(event.target.value)} /></label>
      <Button type="submit" variant="outline" size="sm" disabled={!location || !query.trim() || busy || running}>{t('Search')}</Button>
      <label className={styles.recursive}><input type="checkbox" checked={recursive} onChange={event => setRecursive(event.target.checked)} />{t('Include subfolders')}</label>
    </form>
    {search && <div className={styles.searchStatus} role="status">
      {running ? <Loader2 size={15} className="animate-spin" /> : <Search size={15}/>}
      <span><strong>{search.query}</strong> · {label(search.result && search.result !== 'None' ? search.result : search.state || 'Starting')}
        {running && search.progressPercent != null ? ' · ' + search.progressPercent + '%' : ''}</span>
      {running && <button type="button" className={styles.link} disabled={busy || search.state === 'Stopping'} onClick={stop}>{t('Stop search')}</button>}
      {resultsReady && mode !== 'search' && <button type="button" className={styles.link} onClick={() => { setSkip(0); setMode('search') }}>{t('Search results')}</button>}
      {(!running || pollError) && <button type="button" aria-label={t('Dismiss search')} className={styles.iconButton} onClick={() => { setMode('folder'); setSkip(0); setPollError(''); setWorkspace(current => ({...current, search: undefined})) }}><X size={15}/></button>}
    </div>}
    {pollError && <p className={styles.error} role="alert">{diagnostic(pollError)}</p>}
    <div className={styles.layout}>
      {location && <GuestFolderTree sessionId={sessionId} sourceKey={sourceKey} root={root} separator={separator} path={currentPath} navigate={navigate}/>}
      <div className={styles.content}>
        <nav className={styles.crumbs} aria-label={t('Guest folder path')}>
          <button type="button" onClick={() => navigate(location?.root)}><HardDrive size={15}/>{t('Guest file system')}</button>
          {guestCrumbs(mode === 'search' && search ? search.path : currentPath, separator).map(crumb => <span key={crumb.path}><ChevronRight size={12}/>
            <button type="button" onClick={() => navigate(crumb.path)}>{crumb.label}</button></span>)}
          {mode === 'search' && <span><ChevronRight size={12}/>{t('Search results')}</span>}
        </nav>
        {loading && <p className={styles.note} role="status"><Loader2 size={15} className="animate-spin"/>{t('Loading…')}</p>}
        {directory && <ul className={styles.list}>{directory.items.map(item => {
          const full = guestItemPath(item, directory)
          const covered = cart.some(entry => entry.type === 'Folder' && isBelow(full, entry.path, separator))
          const checked = covered || cart.some(entry => samePath(full, entry.path, separator))
          const folder = item.type === 'Drive' || item.type === 'Folder'
          const knownPath = mode !== 'search' || item.type === 'Drive' || !!item.location || !search?.recursive
          const Icon = item.type === 'Drive' ? HardDrive : folder ? Folder : File
          return <li key={full}>
            {item.type !== 'Drive' ? <input type="checkbox" aria-label={full} checked={knownPath && checked} disabled={covered || !knownPath}
              onChange={event => { if (item.type === 'Drive') return; if (event.target.checked) add({path: full, type: item.type}); else remove(full) }}/> : <span/>}
            <Icon size={16} className={styles.itemIcon}/>
            <div>{folder && knownPath ? <button type="button" className={styles.folderLink} onClick={() => navigate(full)}>{item.displayName || item.name}<ChevronRight size={12}/></button>
              : <span>{item.displayName || item.name}</span>}
              {mode === 'search' && item.location && <button type="button" title={t('Open containing folder')} className={styles.itemPath} onClick={() => navigate(item.location)}><FolderOpen size={12}/>{item.location}</button>}</div>
            {item.type === 'File' && <small>{size(item.size)}</small>}
          </li>
        })}</ul>}
        {directory && !directory.items.length && <p className={styles.note}>{mode === 'search' ? t('No results') : t('This folder is empty.')}</p>}
        {error && <div className={styles.note} role="alert"><span className={styles.error}>{diagnostic(error)}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => setRevision(n => n + 1)}>{t('Refresh')}</Button></div>}
        {directory && (skip > 0 || skip + directory.pagination.count < directory.pagination.total) && <div className={styles.pager}>
          <Button type="button" size="sm" variant="ghost" disabled={!skip} onClick={() => setSkip(Math.max(0, skip - directory.pagination.limit))}>{t('Previous')}</Button>
          <span>{skip + 1}–{skip + directory.pagination.count} / {directory.pagination.total}</span>
          <Button type="button" size="sm" variant="ghost" disabled={!directory.pagination.count || skip + directory.pagination.count >= directory.pagination.total}
            onClick={() => setSkip(skip + directory.pagination.count)}>{t('Next')}</Button>
        </div>}
      </div>
    </div>
    <div className={styles.cart}>
      <div className={styles.cartBar}>
        <button type="button" onClick={() => setShowCart(!showCart)} aria-expanded={showCart}><ShoppingCart size={16}/><strong>{t('Recovery cart')}</strong><span>{cart.length}</span></button>
        <Button type="button" size="sm" disabled={!cart.length || restoreDisabled || !location || busy} onClick={onRestore}><Check size={14}/>{t('Restore selected files')}</Button>
      </div>
      {(!!cart.length || workspace.download) && <GuestDownloadPanel sessionId={sessionId} sourceKey={sourceKey} workspace={workspace}
        setWorkspace={setWorkspace} enabled={!!location && !busy}/>}
      {showCart && (cart.length ? <ul className={styles.cartList}>{cart.map(entry => <li key={entry.path}>{entry.type === 'Folder' ? <Folder size={14}/> : <File size={14}/>}
        <span>{entry.path}</span><button type="button" aria-label={t('Remove {name}', {name: entry.path})} className={styles.iconButton} onClick={() => remove(entry.path)}><X size={14}/></button></li>)}</ul>
        : <p className={styles.note}>{t('Select files or folders to add them to the cart.')}</p>)}
    </div>
  </div>
}
