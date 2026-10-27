"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { Command } from 'cmdk'
import { Search, Loader2, Database, BriefcaseBusiness, FileText, Server, X, RotateCw, ArrowUpRight, ShieldCheck, ScanSearch, History, CornerDownLeft } from 'lucide-react'
import { searchPlatforms, type PlatformSearch } from '@/lib/search/client'
import { applicationRequest } from '@/lib/api/application-request'
import { actionLabel, platformLabels, resultPlatform, resultScope, type SearchKind, type SearchPlatform, type SearchResult, type SearchScope, type PreviewResponse } from '@/lib/search/model'
import { readRecents, rememberResult, recentResult, type RecentResult } from '@/lib/search/recent'
import s from '@/components/search/spotlight.module.css'

const groups = [
  { type: 'VBR Workload', label: 'Protected workloads · VBR', Icon: Server },
  { type: 'VBR Job', label: 'Jobs · VBR', Icon: BriefcaseBusiness },
  { type: 'VBR Repository', label: 'Repositories · VBR', Icon: Database },
  { type: 'VB365 Job', label: 'Jobs · Microsoft 365', Icon: BriefcaseBusiness },
  { type: 'VB365 Item', label: 'Protected objects · Microsoft 365', Icon: FileText },
  { type: 'VB365 Repository', label: 'Repositories · Microsoft 365', Icon: Database },
] satisfies { type: SearchKind; label: string; Icon: typeof Server }[]
const formatDate = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { year: new Date(value).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Not reported'
function Highlight({ name, query }: { name: string; query: string }) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const expression = words.length ? new RegExp(`(${words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig') : null
  return <>{expression ? name.split(expression).map((part, index) => words.includes(part.toLowerCase()) ? <mark key={index}>{part}</mark> : part) : name}</>
}

type PlatformStates = Partial<Record<SearchPlatform, PlatformSearch>>
type PreviewState = { key: string; data?: PreviewResponse; error?: string; loading: boolean }
export type GlobalSearchProps = { vbrConfigured: boolean; vb365Configured: boolean; sourceScope: string }

export function GlobalSearch({ vbrConfigured, vb365Configured, sourceScope }: GlobalSearchProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [scope, setScope] = React.useState<SearchScope>('all')
  const [retry, setRetry] = React.useState(0)
  const [selectedKey, setSelectedKey] = React.useState('')
  const [recent, setRecent] = React.useState<RecentResult[]>([])
  const [search, setSearch] = React.useState<{ key: string; platforms: PlatformStates }>({ key: '', platforms: {} })
  const [preview, setPreview] = React.useState<PreviewState>({ key: '', loading: false })
  const [previewRetry, setPreviewRetry] = React.useState(0)
  const [viewport, setViewport] = React.useState<{ height: number; top: number }>()
  const router = useRouter()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const searchCache = React.useRef(new Map<string, { platforms: PlatformStates; expires: number }>())
  const previewCache = React.useRef(new Map<string, { data: PreviewResponse; expires: number }>())
  const refreshKey = React.useRef('')
  const text = query.trim(), storageKey = `spotlight-recent:${sourceScope}`
  const platforms = React.useMemo<SearchPlatform[]>(() => [vbrConfigured ? 'vbr' as const : null, vb365Configured ? 'vb365' as const : null].filter((value): value is SearchPlatform => value !== null), [vbrConfigured, vb365Configured])
  const key = JSON.stringify([text, scope, sourceScope, retry])
  const states = React.useMemo(() => platforms.map(platform => ({ platform, state: search.key === key ? search.platforms[platform] : undefined })), [platforms, search, key])
  const loading = text.length >= 2 && states.some(({ state }) => !state || state.status === 'loading')
  const results = React.useMemo(() => text.length >= 2 ? states.flatMap(({ state }) => state?.status === 'ready' ? state.data.results : [])
    : !text ? recent.filter(item => platforms.includes(resultPlatform(item)) && (scope === 'all' || resultScope(item) === scope)).map(recentResult) : [], [text, states, recent, platforms, scope])
  const selected = results.find(item => item.key === selectedKey) || results[0]
  const selectionKey = selected ? JSON.stringify([sourceScope, selected.key, previewRetry]) : ''
  const currentPreview = preview.key === selectionKey ? preview : undefined
  const displayed = currentPreview?.data?.result || selected
  const needsPreview = !!selected && (!!selected.lazy || !selected.url)
  const previewLoading = needsPreview && (!currentPreview || currentPreview.loading)
  const notices = text.length >= 2 ? states.flatMap(({ platform, state }) => state?.status === 'error' ? [{ platform, message: state.message }]
    : state?.status === 'ready' ? state.data.warnings.map(message => ({ platform, message })) : []) : []
  const limited = states.some(({ state }) => state?.status === 'ready' && state.data.total > state.data.results.length)
  const indexedAt = selected ? states.find(state => state.platform === resultPlatform(selected))?.state : undefined
  const observedAt = currentPreview?.data?.fetchedAt || (indexedAt?.status === 'ready' ? indexedAt.data.fetchedAt : '')
  const ItemIcon = groups.find(group => group.type === displayed?.type)?.Icon || ScanSearch

  React.useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault(); setIsOpen(true); inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  React.useEffect(() => {
    if (!isOpen) return
    try { setRecent(readRecents(JSON.parse(sessionStorage.getItem(storageKey) || '[]'))) }
    catch { setRecent([]) }
  }, [isOpen, storageKey])

  React.useEffect(() => {
    const visible = window.visualViewport
    if (!isOpen || !visible) return
    // Keep phone controls above the software keyboard without changing desktop layout.
    const update = () => setViewport(visible.scale === 1 ? { height: visible.height, top: visible.offsetTop } : undefined)
    update(); visible.addEventListener('resize', update); visible.addEventListener('scroll', update)
    return () => { visible.removeEventListener('resize', update); visible.removeEventListener('scroll', update) }
  }, [isOpen])

  React.useEffect(() => {
    if (!isOpen || text.length < 2) return
    const cached = searchCache.current.get(key)
    if (cached && cached.expires > Date.now()) { setSearch({ key, platforms: cached.platforms }); return }
    const controller = new AbortController()
    const received: PlatformStates = Object.fromEntries(platforms.map(platform => [platform, { status: 'loading' }]))
    setSearch({ key, platforms: { ...received } })
    const timer = setTimeout(() => {
      const refresh = refreshKey.current === key
      if (refresh) refreshKey.current = ''
      void searchPlatforms(text, platforms, controller.signal, (platform, result) => {
        received[platform] = result
        setSearch({ key, platforms: { ...received } })
      }, undefined, scope, refresh).then(() => {
        if (controller.signal.aborted) return
        const complete = Object.values(received).every(state => state.status === 'ready' && !state.data.warnings.length)
        searchCache.current.set(key, { platforms: { ...received }, expires: Date.now() + (complete ? 30000 : 3000) })
        while (searchCache.current.size > 30) searchCache.current.delete(searchCache.current.keys().next().value!)
      })
    }, 180)
    return () => { clearTimeout(timer); controller.abort() }
  }, [text, key, platforms, scope, isOpen])

  React.useEffect(() => {
    if (!isOpen || !selected || !needsPreview) return
    const cached = previewCache.current.get(selectionKey)
    if (cached && cached.expires > Date.now()) { setPreview({ key: selectionKey, data: cached.data, loading: false }); return }
    const controller = new AbortController()
    setPreview({ key: selectionKey, loading: true })
    const timer = setTimeout(() => {
      const platform = resultPlatform(selected) === 'vbr' ? 'vbr' : 'vbm'
      void applicationRequest<PreviewResponse>(`/api/${platform}/search/preview?${new URLSearchParams({ key: selected.key })}`, { signal: controller.signal }).then(data => {
        if (controller.signal.aborted) return
        if (data.result.key !== selected.key) throw new Error('The preview did not match the selected result. Search again.')
        previewCache.current.set(selectionKey, { data, expires: Date.now() + (data.complete ? 30000 : 3000) })
        while (previewCache.current.size > 30) previewCache.current.delete(previewCache.current.keys().next().value!)
        setPreview({ key: selectionKey, data, loading: false })
      }).catch(error => {
        if (!controller.signal.aborted) setPreview({ key: selectionKey, loading: false, error: error instanceof Error ? error.message : 'Preview unavailable. Open the full inspection to retry.' })
      })
    }, 220)
    return () => { clearTimeout(timer); controller.abort() }
  }, [isOpen, selected, needsPreview, selectionKey])

  const openResult = () => {
    if (!displayed?.url) return
    const next = rememberResult(recent, displayed)
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* Search works without browser storage. */ }
    setRecent(next); setIsOpen(false); setQuery(''); setSelectedKey(''); router.push(displayed.url)
  }
  const clearRecent = () => {
    setRecent([])
    try { sessionStorage.removeItem(storageKey) } catch { /* Optional local history. */ }
  }
  const refreshSearch = () => {
    refreshKey.current = JSON.stringify([text, scope, sourceScope, retry + 1])
    searchCache.current.clear(); previewCache.current.clear()
    setRetry(value => value + 1); setPreviewRetry(value => value + 1)
    inputRef.current?.focus()
  }
  const statusText = text.length === 1 ? 'Enter 2 or more characters' : loading ? results.length ? 'More results loading…' : 'Searching…' : `${results.length} ${text ? results.length === 1 ? 'match' : 'matches' : 'recent'}`
  const resultItem = (item: SearchResult) => {
    const Icon = groups.find(group => group.type === item.type)?.Icon || ScanSearch
    return <Command.Item key={item.key} value={item.key} className={s.item} onSelect={() => setSelectedKey(item.key)} aria-label={`${item.name}, ${item.description}`}>
      <Icon size={17} /><div className={s.itemText}>
        <span className={s.name}><Highlight name={item.name} query={text} /></span>
        <span className={s.description}>{item.description}</span>
        {item.signal && <span className={s.signal} data-tone={item.signal.tone}>{item.signal.label}</span>}
        {item.approximate && <span className={s.similar}>Similar name</span>}
      </div>
    </Command.Item>
  }

  return <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
    <Dialog.Trigger asChild><button type="button" className={s.trigger} aria-label="Open global search"><Search size={17} /><span>Search workloads, jobs, repositories…</span><kbd>Ctrl / ⌘ K</kbd></button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className={s.overlay} /><Dialog.Content className={s.dialog} style={viewport ? { '--spotlight-height': `${viewport.height}px`, '--spotlight-top': `${viewport.top}px` } as React.CSSProperties : undefined} onOpenAutoFocus={event => { event.preventDefault(); inputRef.current?.focus() }}>
      <div className={s.brand}><ShieldCheck size={16} /><Dialog.Title className={s.brandTitle}>Protection search</Dialog.Title><span className={s.sourceLabel}>{platforms.map(platform => platformLabels[platform]).join(' · ') || 'No sources connected'}</span></div>
      <Dialog.Description className="sr-only">Find workloads, jobs and repositories. Use arrow keys to preview a result, Enter to open its inspection, and Escape to close.</Dialog.Description>
      <Command label="Protection search" shouldFilter={false} loop value={selected?.key || ''} onValueChange={setSelectedKey} className={s.command}
        onKeyDownCapture={event => { if (event.key === 'Enter' && event.target === inputRef.current && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); openResult() } }}>
        <div className={s.inputRow}><Search size={23} /><Command.Input ref={inputRef} className={s.input} placeholder="Search your protection estate…" value={query} maxLength={200} onValueChange={value => { setQuery(value); setSelectedKey('') }} />
          {query && <button type="button" className={`${s.iconButton} ${s.clear}`} aria-label="Clear search" onClick={() => { setQuery(''); inputRef.current?.focus() }}>Clear</button>}
          <Dialog.Close asChild><button type="button" className={s.iconButton} aria-label="Close search"><X size={19} /></button></Dialog.Close>
        </div>
        <div className={s.toolbar}><select aria-label="Search result type" className={s.select} value={scope} onChange={event => { setScope(event.target.value as SearchScope); setSelectedKey('') }}>
          <option value="all">All types</option><option value="workloads">Workloads</option><option value="jobs">Jobs</option><option value="repositories">Repositories</option>
        </select><span className={s.count} role="status">{loading && <Loader2 size={12} className={s.spin} />}{statusText}</span>
          <button type="button" className={s.iconButton} aria-label="Refresh search results" title="Refresh search results" disabled={text.length < 2 || loading} onClick={refreshSearch}><RotateCw size={14} /></button></div>
        <div className={s.body}>
          <div className={s.listPane}><div className={s.listHeading}><span>{text ? results.length && results.every(item => item.approximate) ? 'Similar names' : 'Best matches' : 'Recent destinations'}</span>{!text && recent.length > 0 && <button type="button" onClick={clearRecent}>Clear recent</button>}</div>
            <Command.List className={s.list} aria-label="Search results">
              {text ? groups.map(group => { const items = results.filter(item => item.type === group.type); return items.length > 0 && <Command.Group key={group.type} heading={group.label} className={s.group}>{items.map(resultItem)}</Command.Group> }) : results.map(resultItem)}
              {!results.length && <div className={s.empty}>{loading ? <Loader2 size={23} className={s.spin} /> : text ? <Search size={23} /> : <History size={23} />}
                <strong>{loading ? 'Finding your results' : text ? notices.length ? 'Some sources could not be searched' : text.length < 2 ? 'Keep typing' : 'No matching results' : 'Your next investigation starts here'}</strong>
                <p>{loading ? 'Each source appears as soon as it responds.' : text ? 'Try a workload name, job, repository, ID, or mailbox address.' : 'Search to preview protection evidence. Destinations you open appear here for this browser session.'}</p>
                {!platforms.length && <Link href="/connect" onClick={() => setIsOpen(false)}>Connect a data source</Link>}
              </div>}
              {limited && <p className={s.note}>Showing up to 20 matches per source. Refine the name or choose a type.</p>}
            </Command.List>
            {notices.length > 0 && <details className={s.notices} open={!results.length && !loading}><summary>{notices.length} source {notices.length === 1 ? 'notice' : 'notices'}</summary>
              {notices.map(({ platform, message }, index) => <p key={`${platform}:${index}`}><strong>{platformLabels[platform]}:</strong> {message}</p>)}
              <div className={s.noticeActions}><button type="button" onClick={refreshSearch}><RotateCw size={12} />Retry</button><Link href="/administration/data-sources" onClick={() => setIsOpen(false)}>Data sources</Link></div>
            </details>}
          </div>
          <aside className={s.preview} aria-label="Selected result preview">
            {displayed ? <><div className={s.previewContent}>
              <div className={s.eyebrow}><ItemIcon size={16} />{platformLabels[resultPlatform(displayed)]} · {resultScope(displayed) === 'workloads' ? 'Protected object' : resultScope(displayed) === 'jobs' ? 'Backup job' : 'Repository'}</div>
              <h2 className={s.title}>{displayed.name}</h2><p className={s.description}>{displayed.description}</p>
              {displayed.signal && <span className={s.signal} data-tone={displayed.signal.tone}>{displayed.signal.label}</span>}
              {previewLoading && <div className={s.previewLoading} role="status"><Loader2 size={13} className={s.spin} />Loading selected evidence…</div>}
              {!!displayed.facts?.length && <dl className={s.facts}>{displayed.facts.map(fact => <div className={s.fact} key={fact.label}><dt>{fact.label}</dt><dd>{fact.kind === 'date' ? <time dateTime={fact.value}>{formatDate(fact.value)}</time> : fact.value}</dd></div>)}</dl>}
              {currentPreview?.error && <div className={s.previewError} role="status">{currentPreview.error}<button type="button" onClick={() => setPreviewRetry(value => value + 1)}>Retry preview</button></div>}
              {currentPreview?.data?.warnings.map((warning, index) => <p key={index} className={s.note}>{warning}</p>)}
              {displayed.note && <p className={s.note}>{displayed.note}</p>}
              </div><div className={s.previewAction}><button type="button" className={s.inspect} disabled={!displayed.url} onClick={openResult}>{actionLabel(displayed)}<ArrowUpRight size={16} /></button></div>
            </> : <div className={s.emptyPreview}><ScanSearch size={26} /><h3>See the context.<br />Then take the next step.</h3><p>Select a result to preview recovery points, job health, or repository capacity before opening its full inspection.</p></div>}
          </aside>
        </div>
        <div className={s.footer}><div className={s.hint}><span><kbd>↑ ↓</kbd> Preview</span><span><kbd>↵</kbd> Inspect</span><span><kbd>Esc</kbd> Close</span></div>
          <span className={s.timestamp}>{observedAt ? `Evidence · ${formatDate(observedAt)}` : 'Search selected data sources'}</span>
          {displayed && <button type="button" className={s.mobileOpen} disabled={!displayed.url} onClick={openResult}>Inspect<CornerDownLeft size={15} /></button>}
        </div>
      </Command>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>
}
