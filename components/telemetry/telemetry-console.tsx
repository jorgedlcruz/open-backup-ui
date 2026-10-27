'use client'

import { useCallback, useEffect, useState } from 'react'
import { Activity, ArrowDownToLine, CheckCircle2, CircleHelp, Cloud, CloudOff, ExternalLink, Fingerprint, Globe2, Loader2, Monitor, RefreshCw, Search, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Panel } from '@/components/investigation/shared'
import { enableTelemetry, disableTelemetry, STORAGE_KEY, TELEMETRY_PREFERENCE_EVENT } from '@/lib/telemetry'
import { collectionState, diagnostics, diagnosticReport, type CaptureSetting, type Snapshot } from '@/lib/telemetry/model'
import { telemetrySnapshot, TELEMETRY_STATUS_EVENT } from '@/lib/telemetry/runtime'
import { cn } from '@/lib/utils'
import ops from '@/components/operations/operations.module.css'
import styles from './telemetry.module.css'

const labels: Record<CaptureSetting, string> = { enabled: 'Enabled in SDK', disabled: 'Disabled', custom: 'Custom configuration', 'project-managed': 'Project controlled', unknown: 'Not available' }
const date = (value: string) => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function TelemetryConsole() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'attention'>('all'), [query, setQuery] = useState('')
  const refresh = useCallback(() => setSnapshot(telemetrySnapshot()), [])
  useEffect(() => {
    refresh()
    const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === null) refresh() }
    for (const event of [TELEMETRY_STATUS_EVENT, TELEMETRY_PREFERENCE_EVENT, 'online', 'offline', 'focus']) window.addEventListener(event, refresh)
    window.addEventListener('storage', onStorage)
    return () => {
      for (const event of [TELEMETRY_STATUS_EVENT, TELEMETRY_PREFERENCE_EVENT, 'online', 'offline', 'focus']) window.removeEventListener(event, refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [refresh])

  function toggle(enabled: boolean) {
    setError(null); setNotice(null)
    const saved = enabled ? enableTelemetry() : disableTelemetry()
    if (!saved) setError('The preference could not be saved. Allow browser storage, then try again. The setting has not been changed.')
    else setNotice(enabled ? 'Usage sharing is allowed in this browser. Review collection status for SDK readiness.' : 'Usage sharing is disabled in this browser. Previously shared data is not deleted.')
    refresh()
  }
  function exportDiagnostics() {
    try {
      const current = telemetrySnapshot(); setSnapshot(current)
      const url = URL.createObjectURL(new Blob([JSON.stringify(diagnosticReport(current), null, 2)], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = 'open-backup-ui-telemetry-diagnostics.json'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice('Diagnostics downloaded locally. Nothing was uploaded.'); setError(null)
    } catch { setError('Diagnostics could not be downloaded. Refresh and try again.') }
  }
  const state = snapshot ? collectionState(snapshot) : null
  const checks = snapshot ? diagnostics(snapshot) : []
  const issues = checks.filter(check => check.tone === 'warning').length
  const visible = checks.filter(check => (filter === 'all' || check.tone === 'warning') && `${check.name} ${check.status} ${check.detail}`.toLowerCase().includes(query.trim().toLowerCase()))
  const categories = snapshot ? [
    { title: 'Page views', status: labels[snapshot.pageViews], detail: 'Automatic page-view events are disabled by this application. It has no manual page-view capture calls.' },
    { title: 'Feature interactions', status: labels[snapshot.interactions], detail: 'SDK autocapture can include clicks, input changes, form interactions, page URLs and element context. Project controls can further restrict capture.' },
    { title: 'Browser & device context', status: 'Included with events', detail: 'SDK events may include browser, operating system, screen dimensions and generated browser/session identifiers. These are not directly identified user profiles.' },
    { title: 'Location & IP processing', status: 'Project controlled', detail: 'The analytics service can derive location from request IP addresses. Project-side IP and geolocation settings are not inspected here.' },
    { title: 'JavaScript errors', status: labels[snapshot.exceptions], detail: 'Automatic exception capture is controlled by the SDK/project configuration. Error messages and stack traces may be included when enabled.' },
    { title: 'Session replay', status: labels[snapshot.sessionReplay], detail: 'Session recording is explicitly disabled by the application.' },
  ] : []

  return <div className={cn(ops.console, styles.page, 'ph-no-capture')}>
    <header className={ops.header}><div><h1>Telemetry</h1><p>Control usage sharing and inspect collection readiness in this browser.</p></div><div className={styles.actions}><Button variant="outline" disabled={!snapshot} onClick={() => { refresh(); setNotice('Local diagnostics refreshed. No test event was sent.'); setError(null) }}><RefreshCw size={14} />Refresh diagnostics</Button><Button variant="outline" disabled={!snapshot} onClick={exportDiagnostics}><ArrowDownToLine size={14} />Download diagnostics</Button></div></header>
    {error && <div className={ops.notice} role="alert"><TriangleAlert size={18} /><div>{error}</div></div>}
    {notice && <div className={styles.notice} role="status"><CheckCircle2 size={16} />{notice}</div>}
    {!snapshot || !state ? <div className={ops.loading}><Loader2 className="animate-spin" /><h2>Reading telemetry status</h2><p>Inspecting local preferences and SDK configuration.</p></div> : <>
      <div className={cn(ops.metrics, styles.metrics)} aria-label="Telemetry summary">
        <div className={ops.metric}><div className={ops.metricLabel}>Collection status<Activity size={16} /></div><strong className={ops[state.tone]}>{state.label}</strong><p>{state.detail}</p></div>
        <div className={ops.metric}><div className={ops.metricLabel}>Usage sharing{snapshot.preference.enabled ? <Cloud size={16} /> : <CloudOff size={16} />}</div><strong>{snapshot.preference.enabled === null ? 'Unknown' : snapshot.preference.enabled ? 'Allowed' : 'Disabled'}</strong><p>{snapshot.preference.source === 'default' ? 'Application default for this browser' : 'Browser-local preference'}</p></div>
        <div className={ops.metric}><div className={ops.metricLabel}>Session replay<ShieldCheck size={16} /></div><strong>{labels[snapshot.sessionReplay]}</strong><p>{snapshot.recording === true ? 'Recording reported active · investigate below' : 'Application recording policy'}</p></div>
        <button type="button" className={cn(ops.metric, styles.issueMetric)} onClick={() => setFilter(issues ? 'attention' : 'all')} aria-label={`Show ${issues} diagnostics needing attention`}><div className={ops.metricLabel}>Diagnostics<Monitor size={16} /></div><strong className={issues ? ops.warning : ops.success}>{issues ? `${issues} to review` : 'No local issues'}</strong><p>{checks.length} local checks · delivery not verified</p></button>
      </div>

      <div className={styles.grid}>
        <Panel title="Data sharing settings" subtitle="Your existing usage-data preference, applied immediately." action={<span className={cn(ops.badge, ops.neutral)}>This browser</span>}>
          <div className={styles.sharing}>
            {!snapshot.configured && <div className={styles.callout}><TriangleAlert size={17} /><div><strong>Telemetry is not configured</strong><p>The application needs a PostHog project token and destination. Collection stays inactive until configured.</p></div></div>}
            <div className={styles.switchRow}><div><label htmlFor="telemetry-mode">Share Usage Data</label><p>Allow usage events to help improve the application. Your choice applies to this site in this browser.</p></div><Switch id="telemetry-mode" checked={snapshot.preference.enabled === true} onCheckedChange={toggle} disabled={!snapshot.configured || snapshot.preference.source === 'unavailable'} aria-describedby="telemetry-scope" /></div>
            <p id="telemetry-scope" className={styles.hint}>Changes synchronize across open tabs on this origin. Turning sharing off stops future capture; it does not delete previously shared events. Clearing site storage restores the application default.</p>
            <div className={styles.boundaries}><ShieldCheck size={19} /><div><h3>What this application sends</h3><p>It does not explicitly send backup API response bodies, credentials, or user profiles to analytics. Browser event metadata can still contain page URLs and element context, so this is not a guarantee that every event is anonymous.</p></div></div>
            <p className={styles.hint}>Telemetry is separate from the operational data shown in your dashboards, AI summaries, and Next.js build telemetry.</p>
          </div>
        </Panel>
        <Panel title="Destination & scope" subtitle="Local configuration evidence; no provider connection test.">
          <div className={styles.destination}><div className={styles.provider}><Globe2 size={26} /><div><h3>PostHog</h3><p>Browser usage analytics</p></div><span className={cn(ops.badge, snapshot.configured ? ops.success : ops.warning)}>{snapshot.configured ? 'Configured' : 'Not configured'}</span></div>
            <dl className={styles.facts}><div><dt>Collection destination</dt><dd>{snapshot.destination || 'Not configured'}</dd></div><div><dt>SDK version</dt><dd>{snapshot.sdkVersion || 'Not available'}</dd></div><div><dt>Project token</dt><dd>{snapshot.configured ? 'Configured · value hidden' : 'Missing or invalid configuration'}</dd></div><div><dt>Preference scope</dt><dd>This browser and site</dd></div><div><dt>Last inspected</dt><dd>{date(snapshot.checkedAt)}</dd></div><div><dt>Service delivery</dt><dd>Not verified</dd></div></dl>
            <div className={styles.exportNote}><Fingerprint size={16} /><p>The diagnostics download excludes project tokens, browser/session IDs, page URLs, credentials, event payloads, and raw errors. It stays on your device.</p></div>
            <a className={styles.docLink} href="https://posthog.com/docs/privacy/data-collection" target="_blank" rel="noreferrer">PostHog collection controls <ExternalLink size={12} /></a>
          </div>
        </Panel>
      </div>

      <Panel title="Collection details" subtitle="Configured categories describe what may be collected when sharing is permitted. They are not event counts." className={styles.section}>
        <div className={styles.categories}>{categories.map(category => <article key={category.title}><div><h3>{category.title}</h3><span className={cn(ops.badge, category.status === 'Disabled' ? ops.success : ops.neutral)}>{category.status}</span></div><p>{category.detail}</p></article>)}</div>
      </Panel>

      <Panel title="Local diagnostics" subtitle="Inspect configuration and browser state without transmitting a diagnostic event." action={<span className={cn(ops.badge, issues ? ops.warning : ops.neutral)}>{issues} to review</span>} className={styles.section}>
        <div className={styles.toolbar}><div className={ops.filterList}><button type="button" aria-pressed={filter === 'all'} className={filter === 'all' ? ops.filterSelected : ''} onClick={() => setFilter('all')}>All checks <span>{checks.length}</span></button><button type="button" aria-pressed={filter === 'attention'} className={filter === 'attention' ? ops.filterSelected : ''} onClick={() => setFilter('attention')}>Needs attention <span>{issues}</span></button></div><label className={styles.search}><Search size={14} /><input aria-label="Search diagnostics" placeholder="Find a diagnostic…" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
        {visible.length ? <div className={styles.checks}>{visible.map(check => <article key={check.id}><div className={cn(styles.checkIcon, ops[check.tone])}>{check.tone === 'warning' ? <TriangleAlert size={17} /> : check.tone === 'success' ? <CheckCircle2 size={17} /> : <CircleHelp size={17} />}</div><div><div className={styles.checkHeading}><h3>{check.name}</h3><span className={cn(ops.badge, ops[check.tone])}>{check.status}</span></div><p>{check.detail}</p></div></article>)}</div> : <div className={ops.empty}><CheckCircle2 size={22} /><p>{query ? 'No diagnostics match your search.' : 'No local checks need attention. Event delivery remains unverified.'}</p><Button variant="outline" size="sm" onClick={() => { setFilter('all'); setQuery('') }}>Show all checks</Button></div>}
        <div className={ops.panelFoot}>Request failures are observed locally for this runtime only. Refresh does not clear past failures or prove that later requests succeeded.</div>
      </Panel>
      <footer className={ops.footer}><span><ShieldCheck size={12} />Browser-scoped controls · local diagnostics</span><span>No diagnostic test event · no background health polling</span></footer>
    </>}
  </div>
}
