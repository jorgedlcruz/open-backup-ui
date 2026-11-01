'use client'

import { Trans , useI18n } from '@/components/providers/i18n-provider'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Activity, ArrowRight, Bot, CheckCircle2, CircleHelp, ExternalLink, Eye, EyeOff, KeyRound, Loader2, RefreshCw, Save, Search, Server, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Panel } from '@/components/investigation/shared'
import { connectionLabels, credentialLabels, modelEvidence, modelId, modelOptions, providers, staleCheck, type Check, type Configuration, type CredentialSource, type Draft, type Provider } from '@/lib/ai-integrations/model'
import { requestAiConfiguration as request } from '@/lib/ai-integrations/request'
import { cn } from '@/lib/utils'
import ops from '@/components/operations/operations.module.css'
import styles from './integrations.module.css'

const date = (value: string) => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function AiIntegrationsConsole() {
  const { t: uiText } = useI18n()

  const [saved, setSaved] = useState<Configuration | null>(null), [draft, setDraft] = useState<Draft | null>(null)
  const [pending, setPending] = useState<'load' | 'save' | 'check' | null>('load'), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null)
  const [feedbackFor, setFeedbackFor] = useState<'load' | 'save' | 'check'>('load')
  const [check, setCheck] = useState<Check | null>(null), [query, setQuery] = useState(''), [showKey, setShowKey] = useState(false), [now, setNow] = useState(Date.now())
  const activeRequest = useRef<AbortController | null>(null)
  const load = useCallback(async () => {
    if (activeRequest.current) return
    const controller = new AbortController(); activeRequest.current = controller
    setPending('load'); setFeedbackFor('load'); setError(null); setNotice(null)
    try {
      const data: Configuration = await request('', controller.signal)
      setSaved(data); setDraft({ provider: data.provider, modelName: data.modelName, apiKey: '' }); setCheck(null); setQuery(''); setShowKey(false)
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Unable to load settings.') }
    finally { if (activeRequest.current === controller) { activeRequest.current = null; setPending(null) } }
  }, [])
  useEffect(() => { void load(); return () => { activeRequest.current?.abort(); activeRequest.current = null } }, [load])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])

  async function run(action: 'save' | 'check') {
    if (!saved || !draft || activeRequest.current) return
    const controller = new AbortController(); activeRequest.current = controller
    setPending(action); setFeedbackFor(action); setError(null); setNotice(null)
    try {
      const result = await request(action === 'check' ? '/check' : '', controller.signal, { ...draft, revision: saved.revision })
      if (controller.signal.aborted) return
      if (action === 'save') {
        const data: Configuration = result
        setSaved(data); setDraft({ provider: data.provider, modelName: data.modelName, apiKey: '' }); setShowKey(false); setCheck(null)
        setNotice('Configuration saved. Check the connection to verify the active settings.')
      } else { setCheck(result); setNow(Date.now()) }
    } catch (error) { if (!controller.signal.aborted) { setError(error instanceof Error ? error.message : 'The request failed.'); if (action === 'check') setCheck(null) } }
    finally { if (activeRequest.current === controller) { activeRequest.current = null; setPending(null) } }
  }
  const dirty = !!saved && !!draft && (saved.provider !== draft.provider || saved.modelName !== draft.modelName || !!draft.apiKey)
  const busy = pending !== null
  function discard() {
    if (!saved) return
    setDraft({ provider: saved.provider, modelName: saved.modelName, apiKey: '' }); setCheck(null); setError(null); setNotice(null); setQuery(''); setShowKey(false)
  }
  function chooseProvider(provider: Provider) {
    if (!draft || provider === draft.provider) return
    setDraft({ provider, modelName: provider === saved?.provider ? saved.modelName : providers[provider].defaultModel, apiKey: '' })
    setCheck(null); setQuery(''); setShowKey(false); setError(null); setNotice(null)
  }
  const credential: CredentialSource = draft?.apiKey ? 'new' : saved && draft?.provider === saved.provider ? saved.credentialSource : draft && saved?.environmentProviders.includes(draft.provider) ? 'environment' : 'missing'
  const fresh = check && !staleCheck(check, now)
  const verified = check?.connection === 'verified'
  const stateLabel = pending === 'check' ? 'Checking…' : !check ? 'Not checked' : !fresh ? 'Check expired' : connectionLabels[check.connection]
  const connectionTone = fresh && verified ? ops.success : fresh && check && ['rejected', 'forbidden', 'service-error', 'unreachable', 'invalid-response'].includes(check.connection) ? ops.danger : check ? ops.warning : ''
  const evidence = fresh ? modelEvidence(check, draft?.modelName || '') : 'unknown'
  const models = draft ? modelOptions(draft.provider, draft.modelName, check?.models) : []
  const matching = models.filter(model => model.id === draft?.modelName || `${model.id} ${model.name}`.toLowerCase().includes(query.trim().toLowerCase()))
  const validModel = !!draft && modelId.safeParse(draft.modelName).success

  return <div className={cn(ops.console, styles.page)}>
    <header className={ops.header}><div><h1><Trans>{"AI Integrations"}</Trans></h1><p>Configure the assistant behind your operational health summaries.</p></div><div className={styles.actions}><Button variant="outline" disabled={busy || dirty} onClick={load}><RefreshCw size={14} className={pending === 'load' ? 'animate-spin' : ''} />Refresh settings</Button></div></header>
    {error && feedbackFor === 'load' && <div className={cn(ops.notice, styles.error)} role="alert"><TriangleAlert size={18} /><div>{error}</div>{!saved && <Button variant="outline" disabled={busy} onClick={load}><Trans>{"Retry"}</Trans></Button>}</div>}
    {!saved || !draft ? pending ? <div className={ops.loading}><Loader2 className="animate-spin" /><h2>Loading AI configuration</h2><p>Reading the active provider and credential status.</p></div> : <div className={ops.empty}><CircleHelp size={24} /><p>Configuration is unavailable. Retry before making changes.</p></div> : <>
      <div className={cn(ops.metrics, styles.metrics)} aria-label="AI integration summary">
        <div className={ops.metric}><div className={ops.metricLabel}>Saved provider<Server size={16} /></div><strong>{providers[saved.provider].name}</strong><p>Active across AI features</p></div>
        <div className={ops.metric}><div className={ops.metricLabel}>Saved model<Bot size={16} /></div><strong className={styles.modelName}>{saved.modelName}</strong><p>Changes take effect when saved</p></div>
        <div className={ops.metric}><div className={ops.metricLabel}>Saved credential<KeyRound size={16} /></div><strong>{credentialLabels[saved.credentialSource]}</strong><p>{saved.credentialSource === 'saved' ? 'Encrypted on the application server' : saved.credentialSource === 'environment' ? 'Provided by this server’s environment' : 'Configure a usable provider credential'}</p></div>
        <div className={ops.metric}><div className={ops.metricLabel}>{dirty ? 'Draft connection' : 'Connection status'}<Activity size={16} /></div><strong className={connectionTone}>{stateLabel}</strong><p>{check ? `Last check ${date(check.checkedAt)}` : 'Run an explicit connection check'}</p></div>
      </div>
      <div className={styles.grid}>
        <Panel title="Provider configuration" subtitle="One active provider for AI health summaries." action={<span className={cn(ops.badge, dirty ? ops.warning : ops.neutral)}>{dirty ? 'Unsaved changes' : 'Saved configuration'}</span>}>
          <form onSubmit={event => { event.preventDefault(); void run('save') }}>
            <fieldset disabled={busy} className={styles.form}>
              <legend className="sr-only">Provider and model settings</legend>
              <div className={styles.providerChoices} aria-label="AI provider">{(Object.keys(providers) as Provider[]).map(provider => <button type="button" key={provider} aria-pressed={draft.provider === provider} onClick={() => chooseProvider(provider)} className={cn(styles.provider, draft.provider === provider && styles.selected)}><div><Bot size={17} />{draft.provider === provider && <CheckCircle2 size={14} />}</div><strong>{providers[provider].name}</strong><span>{providers[provider].description}</span></button>)}</div>
              {saved.provider !== draft.provider && <p className={styles.hint}>Saving replaces the active provider configuration. The previous provider’s saved key will not be reused; enter this provider’s key or use its server environment credential.</p>}
              <div className={styles.field}><div className={styles.fieldHeading}><label htmlFor="ai-api-key">API key</label><span className={cn(ops.badge, credential === 'missing' || credential === 'unreadable' ? ops.warning : ops.neutral)}>{credentialLabels[credential]}</span></div><div className={styles.keyInput}><Input id="ai-api-key" type={showKey ? 'text' : 'password'} value={draft.apiKey} maxLength={4096} autoComplete="new-password" spellCheck={false} placeholder={credential === 'saved' ? 'Leave blank to keep the saved key' : credential === 'environment' ? 'Leave blank to use the server environment' : 'Enter the selected provider’s API key'} onChange={event => { setDraft({ ...draft, apiKey: event.target.value }); setCheck(null); setNotice(null) }} /><Button type="button" variant="ghost" size="icon" aria-label={showKey ? 'Hide new API key' : 'Show new API key'} disabled={!draft.apiKey} onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</Button></div><p className={styles.hint}>Saved keys remain on the server. A replacement key is encrypted when you save; checking a new key does not save it.</p></div>
              <div className={styles.modelSection}><div className={styles.fieldHeading}><label htmlFor="ai-model">Model selection</label><span className={styles.hint}>{query ? `${matching.length} of ` : ''}{models.length} choices</span></div><label className={styles.search}><Search size={14} /><input aria-label={uiText("Filter model choices")} placeholder={uiText("Filter by model name or ID…")} value={query} onChange={event => setQuery(event.target.value)} /></label><select id="ai-model" value={draft.modelName} onChange={event => { setDraft({ ...draft, modelName: event.target.value }); setNotice(null) }}>{!draft.modelName && <option value="">Select a model</option>}{matching.map(model => <option key={model.id} value={model.id}>{model.name}{model.name !== model.id ? ` (${model.id})` : ''}{check?.models.some(item => item.id === model.id) ? ' · API catalog' : ' · Preset / custom'}</option>)}</select>{query && <p className={styles.hint}>The current selection stays visible while filtering.</p>}<p className={styles.hint}>Existing presets are retained. Check the connection to discover the provider’s catalog; model listing alone does not verify text-generation compatibility.</p></div>
              <div className={styles.field}><label htmlFor="ai-model-id">Model ID / custom model</label><Input id="ai-model-id" value={draft.modelName} maxLength={200} spellCheck={false} aria-invalid={!validModel} aria-describedby="ai-model-hint" onChange={event => { setDraft({ ...draft, modelName: event.target.value }); setNotice(null) }} /><p id="ai-model-hint" className={cn(styles.hint, !validModel && ops.danger)}>{validModel ? 'Use the exact model ID supported by your provider. Saved and custom IDs are preserved even when absent from the catalog.' : 'Enter a model ID beginning with a letter or number, without spaces or relative path segments.'}</p></div>
            </fieldset>
            <div className={styles.formFooter}><p>Saving updates the configuration without contacting the provider.</p>
              {feedbackFor === 'save' && error && <div className={cn(styles.feedback, styles.error)} role="alert"><TriangleAlert size={16} aria-hidden="true" /><span>{error}</span></div>}
              {feedbackFor === 'save' && notice && <div className={cn(styles.feedback, styles.success)} role="status"><CheckCircle2 size={16} aria-hidden="true" /><span>{notice}</span></div>}
              <div className={styles.actions}>{dirty && <Button type="button" variant="outline" disabled={busy} onClick={discard}>Discard changes</Button>}<Button type="submit" disabled={busy || !dirty || !validModel}>{pending === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{pending === 'save' ? uiText('Saving…') : 'Save Configuration'}</Button></div></div>
          </form>
        </Panel>
        <div className={styles.sideColumn}>
          <Panel title="Connection & model access" subtitle={`Check ${providers[draft.provider].name} with the configuration shown.`}>
            <div className={styles.connectionBody}>
              <div className={cn(styles.connection, fresh && verified ? styles.connected : '')}>{pending === 'check' ? <Loader2 className="animate-spin" size={24} /> : fresh && verified ? <ShieldCheck size={24} /> : check ? <TriangleAlert size={24} /> : <CircleHelp size={24} />}<div><strong className={connectionTone}>{stateLabel}</strong><p>{check ? check.detail : 'A configured key does not establish a working connection.'}</p></div></div>
              <Button type="button" variant="outline" disabled={busy || !validModel} onClick={() => run('check')}><Activity size={15} />{pending === 'check' ? 'Checking provider…' : 'Check connection & models'}</Button>
              {feedbackFor === 'check' && error && <div className={cn(styles.feedback, styles.error)} role="alert"><TriangleAlert size={16} aria-hidden="true" /><span>{error}</span></div>}
              <p className={styles.hint}>Reads the provider’s model catalog using the selected credential. No prompt, backup data, or inference request is sent.</p>
              <dl className={styles.facts}><div><dt>Credential used</dt><dd>{credentialLabels[check?.credentialSource || credential]}</dd></div><div><dt>Selected model</dt><dd className={evidence === 'listed' ? ops.success : ''}>{evidence === 'listed' ? 'Listed by provider' : evidence === 'not-listed' ? 'Not listed · review model ID' : 'Not verified'}</dd></div><div><dt>Catalog</dt><dd>{check ? `${check.models.length} models · ${check.complete ? 'complete' : 'partial / unavailable'}` : 'Not loaded'}</dd></div><div><dt>Response</dt><dd>{check?.httpStatus ? `HTTP ${check.httpStatus} · ${check.latencyMs.toLocaleString()} ms` : 'Not received'}</dd></div><div><dt>Last checked</dt><dd>{check ? date(check.checkedAt) : 'Not checked this visit'}{check && !fresh && <span className={styles.stale}>Check again for current evidence</span>}</dd></div><div className={styles.endpoint}><dt>Catalog endpoint</dt><dd>{providers[draft.provider].endpoint}</dd></div></dl>
              <a href={providers[draft.provider].docs} target="_blank" rel="noreferrer" className={styles.docLink}>Provider API reference <ExternalLink size={12} /></a>
            </div>
          </Panel>
          <Panel title="Operational health summaries" subtitle="An on-demand assistant for backup administrators."><div className={styles.usage}><div className={styles.usageIcon}><Sparkles size={22} /></div><h3>Turn operational evidence into next steps</h3><p>Generate a health summary from the VBR dashboard. It uses job and session summaries, security findings, and recent audit events.</p><p>Environment context is sent to the saved provider only when you request a summary.</p><Button asChild variant="outline" size="sm"><Link href="/vbr/lens/overview">Open Overview <ArrowRight size={14} /></Link></Button></div></Panel>
        </div>
      </div>
      <footer className={ops.footer}><span><KeyRound size={12} />Credentials stay on the application server</span><span>Explicit checks · evidence expires after 5 minutes · no background provider polling</span></footer>
    </>}
  </div>
}
