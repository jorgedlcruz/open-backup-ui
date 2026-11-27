'use client'
// Open Backup UI v1.3.0
import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, CheckCircle2, Loader2, Plus } from 'lucide-react'
import { applicationRequest, ApplicationRequestError } from '@/lib/api/application-request'
import { useI18n } from '@/components/providers/i18n-provider'
import { DataLoading } from '@/components/ui/data-loading'
import s from '@/components/job-builder/builder.module.css'

const inventory = '/vbr/inventory/entra'
const endpoint = '/api/vbr/entra-inventory/add'
const guid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const sessionIdPattern = new RegExp('^'+guid+'$')
type Setup = { sourceName: string; sourceKey: string; repositoriesComplete: boolean; repositories: { id: string; name: string }[] }

async function encodePfx(file: File, readError: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(new Error(readError))
    reader.readAsDataURL(file)
  })
}

export function AddEntraTenant() {
  const { t } = useI18n()
  const [setup, setSetup] = useState<Setup>()
  const [attempt, setAttempt] = useState(0)
  const [method, setMethod] = useState<'secret' | 'certificate'>('secret')
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState('')
  const [sessionId, setSessionId] = useState('')
  const lock = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    applicationRequest<Setup>(endpoint, { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setSetup(value)
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [attempt])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!setup || lock.current || sessionId || uncertain) return
    lock.current = true
    setError('')
    setBusy(true)
    let submitted = false
    try {
      const values = new FormData(event.currentTarget)
      const value = (name: string) => String(values.get(name) ?? '')
      const file = values.get('pfx')
      if (method === 'certificate' && (!(file instanceof File) || !/\.(pfx|p12)$/i.test(file.name) || !file.size || file.size > 1024 * 1024)) {
        setError(t('Certificate must be a PFX or P12 file of 1 MiB or less.'))
        return
      }
      const credential = method === 'secret' ? { kind: method, secret: value('secret') }
        : { kind: method, certificate: await encodePfx(file as File, t('Certificate file could not be read.')), password: value('password') || undefined }
      submitted = true
      const result = await applicationRequest<{ sessionId: string }>(endpoint, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          sourceKey: setup.sourceKey, azureTenantId: value('tenant').trim(), applicationId: value('app').trim(),
          description: value('description').trim() || undefined, region: value('region') || 'Global',
          cacheRepositoryId: value('repository') || undefined, credential,
        }) })
      if (typeof result?.sessionId !== 'string' || !sessionIdPattern.test(result.sessionId)) {
        setUncertain(true)
        setError(t('Check inventory and VBR sessions before submitting again.'))
      } else setSessionId(result.sessionId)
    } catch (e) {
      const unknown = submitted && (!(e instanceof ApplicationRequestError) || e.kind === 'network' || e.status >= 500 || e.status < 300)
      setUncertain(unknown)
      setError(unknown ? t('Check inventory and VBR sessions before submitting again.') : e instanceof Error ? e.message : t('Request failed'))
    } finally {
      setBusy(false)
      lock.current = false
    }
  }
  return <main className={s.page}>
    <Link href={inventory} className={s.link}><ArrowLeft size={14} className="inline"/> {t('Back to inventory')}</Link>
    <header className={s.header}><div><h1>{t('Add tenant')}</h1><p>{t('Use an existing Microsoft Entra app registration.')}</p></div>
      {setup && <span className={s.source}>{setup.sourceName}</span>}</header>
    {error && <div role="alert" className={s.notice}>{error} {!setup && <button type="button" className={s.link} onClick={() => { setError(''); setAttempt(n => n + 1) }}>{t('Retry')}</button>}</div>}
    {!setup && !error && <DataLoading status={t('Loading tenant settings…')}/>}
    {sessionId ? <section className={s.panel} role="status"><div className={s.panelBody}>
      <p><CheckCircle2 size={16} className="inline"/> {t('VBR accepted the request to add this tenant.')}</p>
      <Link className={s.link} href={'/vbr/sessions/'+sessionId}>{t('View session')}</Link></div></section>
      : setup && <form className={s.panel} onSubmit={submit} autoComplete="off" style={{maxWidth:840}}>
        <fieldset disabled={busy || uncertain} className={s.panelBody}>
          <legend className="sr-only">{t('Tenant settings')}</legend>
          <div className={s.fields}>
            <label className={s.field}>{t('Tenant ID')}<input name="tenant" required pattern={guid} spellCheck={false}/></label>
            <label className={s.field}>{t('Application ID')}<input name="app" required pattern={guid} spellCheck={false}/></label>
            <label className={s.field}>{t('Authentication')}<select value={method} onChange={e => setMethod(e.target.value as typeof method)}>
              <option value="secret">{t('Application secret')}</option><option value="certificate">{t('Application certificate')}</option>
            </select></label>
            {method === 'secret' ? <label className={s.field}>{t('Application secret')}<input type="password" name="secret" autoComplete="off" required maxLength={8192}/></label>
              : <><label className={s.field}>{t('Certificate file (.pfx or .p12)')}<input type="file" name="pfx" accept=".pfx,.p12" required className="file:mr-2"/></label>
                <label className={s.field}>{t('Certificate passphrase')}<input type="password" name="password" autoComplete="off" maxLength={8192}/></label></>}
          </div>
          <details className="mt-5"><summary className={s.link}>{t('More settings')}</summary><div className={s.fields}>
            <label className={s.field}>{t('Description')}<input name="description" maxLength={1024}/></label>
            <label className={s.field}>{t('Region')}<select name="region" defaultValue="Global">
              <option value="Global">{t('Global')}</option><option value="China">{t('China')}</option><option value="Government">{t('Government')}</option>
            </select></label>
            <label className={s.field}>{t('Cache repository')}<select name="repository" defaultValue="">
              <option value="">{t('Use the default cache repository')}</option>
              {setup.repositories.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}
            </select></label>
          </div>{!setup.repositoriesComplete && <p className={s.muted}>{t('Cache repository choices are unavailable.')}</p>}</details>
        </fieldset>
        <div className={s.saveBar}><Link className={s.button} href={inventory}>{t('Back to inventory')}</Link>
          <button type="submit" className={s.primary} disabled={busy || uncertain}>{busy ? <Loader2 className="animate-spin" size={15}/> : <Plus size={15}/>} {t('Add tenant')}</button></div>
      </form>}
  </main>
}
