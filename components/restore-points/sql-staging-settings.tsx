'use client'
// Open Backup UI v1.0.2

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Check, Database, KeyRound, Loader2, Search, ServerCog } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { veeamApi } from '@/lib/api/veeam-client'
import type { SqlStagingSettings as Settings } from '@/lib/recovery/sql-staging'
import { uncertainRestore } from '@/lib/restore-points/workflow'
import { useRecoveryPresentation } from './use-presentation'
import styles from './sql-staging-settings.module.css'

type Scope = { sourceKey: string; sessionId: string }
type Snapshot = { settings: Settings; revision: string; pending?: string }
type Draft = Omit<Settings, 'hasWindowsPassword' | 'hasSqlPassword'> & { windowsPassword: string; sqlPassword: string }
type Task =
  | { status: 'pending'; pending: string }
  | { status: 'saved' }
  | { status: 'choices'; servers: string[] }

const stagingMessages = new Set([
  'SQL staging settings are being updated. Reload their status.',
  'SQL staging settings changed. Reload them before applying your changes.',
  'VBR could not read the SQL staging server settings.',
  'VBR could not validate the SQL staging server. Check the server and credentials.',
  'VBR could not confirm the SQL staging change. Reload the settings before trying again.',
  'Enter the staging server and the required account names.',
  'Enter a password for each new or changed staging account.',
  'Review the SQL staging authentication mode.',
  'Your VBR account cannot change these SQL staging settings.',
  'VBR could not list SQL staging server instances.',
])

function editable(settings: Settings): Draft {
  return {
    enabled: settings.enabled,
    serverName: settings.serverName,
    windowsUsername: settings.windowsUsername,
    sqlAuth: settings.sqlAuth,
    sqlUsername: settings.sqlUsername,
    windowsPassword: '',
    sqlPassword: '',
  }
}

function command<T>(scope: Scope, action: string, fields: Record<string, unknown> = {}, signal?: AbortSignal) {
  return veeamApi.applicationExplorerRequest<T>('sql-explorer', { ...scope, action, ...fields }, signal)
}

function waitForNextPoll(signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop)
      resolve()
    }, 1000)
    signal.addEventListener('abort', stop, { once: true })
  })
}

async function follow(scope: Scope, current: Task, signal: AbortSignal, onPending?: (token: string) => void) {
  while (current.status === 'pending') {
    onPending?.(current.pending)
    await waitForNextPoll(signal)
    current = await command<Task>(scope, 'stagingPoll', { pending: current.pending }, signal)
  }
  return current
}

function receiptKey(scope: Scope) {
  return 'vbr.sql-staging.1/' + scope.sourceKey + '/' + scope.sessionId
}

function putReceipt(key: string, value: string) {
  try {
    if (value) sessionStorage.setItem(key, value)
    else sessionStorage.removeItem(key)
  } catch { /* The open form retains its task. */ }
}

function readReceipt(key: string) {
  try { return sessionStorage.getItem(key) || '' }
  catch { return '' }
}

function statusCode(error: unknown) {
  return error instanceof Error && 'status' in error ? Number(error.status) : 0
}

export function SqlStagingSettings(props: Scope) {
  return <StagingForm key={receiptKey(props)} {...props}/>
}

function StagingForm({ sourceKey, sessionId }: Scope) {
  const { t, diagnostic } = useRecoveryPresentation()
  const id = useId()
  const key = receiptKey({ sourceKey, sessionId })
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [draft, setDraft] = useState<Draft>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [mustReload, setMustReload] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [choosing, setChoosing] = useState(false)
  const lock = useRef(false)
  const pending = useRef('')
  const refreshAfterSave = useRef(false)
  const chooseButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal
    const scope = { sourceKey, sessionId }
    setLoading(true)
    setError('')

    async function settle(token: string) {
      pending.current = token
      setSaving(true)
      const result = await follow(scope, { status: 'pending', pending: token }, signal, next => {
        pending.current = next
        putReceipt(key, next)
      })
      if (result.status !== 'saved') throw Error(t('VBR could not verify this recovery request.'))
      putReceipt(key, '')
      pending.current = ''
      refreshAfterSave.current = true
    }

    async function load() {
      const token = pending.current || readReceipt(key)
      if (token && token !== 'submitted') await settle(token)
      let model = await command<Snapshot>(scope, 'stagingRead', {}, signal)
      while (model.pending) {
        await settle(model.pending)
        model = await command<Snapshot>(scope, 'stagingRead', {}, signal)
      }
      if (signal.aborted) return
      setSnapshot(model)
      setDraft(editable(model.settings))
      setSaved(refreshAfterSave.current)
      setError(token === 'submitted' && !refreshAfterSave.current ? t('Check the saved staging settings before making another change.') : '')
      setMustReload(false)
      putReceipt(key, '')
      pending.current = ''
      refreshAfterSave.current = false
    }

    load().catch(err => {
      if (signal.aborted) return
      const code = statusCode(err)
      if (pending.current && code >= 400 && code < 500 && ![408, 429].includes(code)) {
        // A rejected task token cannot be reused. Refresh will read the current native settings.
        pending.current = 'submitted'
        putReceipt(key, 'submitted')
      }
      setSaved(false)
      setMustReload(true)
      setError(err instanceof Error ? err.message : t('Validation failed.'))
    }).finally(() => {
      if (signal.aborted) return
      setLoading(false)
      setSaving(false)
      lock.current = false
    })
    return () => controller.abort()
  }, [key, sourceKey, sessionId, refresh, t])

  const base = snapshot?.settings
  const replacingSqlAccount = !!base && base.sqlAuth !== 'machine' && draft?.sqlAuth === 'machine'
  const windowsSaved = !replacingSqlAccount && !!base?.hasWindowsPassword && draft?.windowsUsername.trim() === base.windowsUsername
  const sqlSaved = !!base?.hasSqlPassword && draft?.sqlAuth === base.sqlAuth && draft?.sqlUsername.trim() === base.sqlUsername
  const separate = !!draft && draft.sqlAuth !== 'machine'
  const dirty = !!draft && !!base && (
    draft.enabled !== base.enabled ||
    (draft.enabled && (
      draft.serverName.trim() !== base.serverName ||
      draft.windowsUsername.trim() !== base.windowsUsername ||
      !!draft.windowsPassword ||
      draft.sqlAuth !== base.sqlAuth ||
      (separate && (draft.sqlUsername.trim() !== base.sqlUsername || !!draft.sqlPassword))
    ))
  )
  const valid = !!draft && (!draft.enabled || (
    !!draft.serverName.trim() && !!draft.windowsUsername.trim() && (windowsSaved || !!draft.windowsPassword) &&
    (!separate || (!!draft.sqlUsername.trim() && (sqlSaved || !!draft.sqlPassword)))
  ))
  const blocked = saving || loading || mustReload

  function edit(patch: Partial<Draft>) {
    setDraft(current => current ? { ...current, ...patch } : current)
    setSaved(false)
    setError('')
  }

  function reset() {
    if (base) setDraft(editable(base))
    setChoosing(false)
    setError('')
  }

  function reload() {
    setChoosing(false)
    setSaved(false)
    setRefresh(value => value + 1)
  }

  function closeChooser() {
    setChoosing(false)
    chooseButton.current?.focus()
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || !snapshot || !dirty || !valid || blocked || lock.current) return
    lock.current = true
    setSaving(true)
    setError('')
    setSaved(false)
    setChoosing(false)

    // Disabling staging preserves the original connection and credentials at VBR.
    const values = draft.enabled ? draft : { ...editable(snapshot.settings), enabled: false }
    const settings = {
      enabled: values.enabled,
      serverName: values.serverName.trim(),
      windowsUsername: values.windowsUsername.trim(),
      sqlAuth: values.sqlAuth,
      sqlUsername: values.sqlAuth === 'machine' ? '' : values.sqlUsername.trim(),
      ...(values.enabled && values.windowsPassword && { windowsPassword: values.windowsPassword }),
      ...(values.enabled && values.sqlAuth !== 'machine' && values.sqlPassword && { sqlPassword: values.sqlPassword }),
    }
    putReceipt(key, 'submitted')
    try {
      const result = await command<Task>({ sourceKey, sessionId }, 'stagingSave', { revision: snapshot.revision, settings })
      if (result.status === 'pending') {
        pending.current = result.pending
        putReceipt(key, result.pending)
      } else if (result.status === 'saved') {
        putReceipt(key, '')
        refreshAfterSave.current = true
      } else {
        throw new TypeError(t('VBR could not verify this recovery request.'))
      }
      setDraft(current => current ? { ...current, windowsPassword: '', sqlPassword: '' } : current)
      setRefresh(value => value + 1)
    } catch (err) {
      const uncertain = uncertainRestore(err)
      const code = statusCode(err)
      if (!uncertain) putReceipt(key, '')
      setMustReload(uncertain || code === 409 || code === 403)
      const reason = err instanceof Error ? err.message : t('Validation failed.')
      const exposesPassword = [values.windowsPassword, values.sqlPassword].some(password => !!password && reason.includes(password))
      if (uncertain) {
        setError(t('Check the saved staging settings before making another change.'))
        setDraft(current => current ? { ...current, windowsPassword: '', sqlPassword: '' } : current)
      } else {
        setError(exposesPassword ? t('Validation failed.') : reason)
      }
      lock.current = false
      setSaving(false)
    }
  }

  return (
    <section className={styles.panel} aria-labelledby={id + '-title'}>
      <header className={styles.header}>
        <span className={styles.symbol}><ServerCog size={22} aria-hidden/></span>
        <div>
          <h3 id={id + '-title'}>{t('SQL staging server')}</h3>
          <p>{t('These settings apply to SQL recoveries across this VBR server.')}</p>
        </div>
      </header>
      {loading && (
        <p className={styles.status} role="status">
          <Loader2 size={16} className="motion-safe:animate-spin"/>
          {saving ? t('Validating staging settings…') : t('Loading…')}
        </p>
      )}
      {error && (
        <div className={styles.feedback} role="alert">
          <span>{stagingMessages.has(error) ? t(error) : diagnostic(error)}</span>
          {mustReload && !loading && <Button variant="outline" size="sm" onClick={reload}>{t('Refresh')}</Button>}
        </div>
      )}
      {draft && (
        <form onSubmit={save} className={styles.form}>
          <label className={styles.toggle}>
            <input
              type="checkbox" role="switch" checked={draft.enabled} disabled={blocked}
              onChange={event => {
                edit({ enabled: event.target.checked, windowsPassword: '', sqlPassword: '' })
                setChoosing(false)
              }}
            />
            <span>{t('Use a staging SQL Server')}</span>
          </label>
          <fieldset className={styles.connection} disabled={!draft.enabled || blocked}>
            <div className={styles.instance}>
              <label htmlFor={id + '-server'}>{t('SQL instance')}</label>
              <div className={styles.instanceRow}>
                <Input
                  id={id + '-server'} value={draft.serverName} required={draft.enabled} maxLength={512}
                  placeholder={'SERVER\\INSTANCE'} autoComplete="off" onChange={event => edit({ serverName: event.target.value })}
                />
                <Button
                  ref={chooseButton} type="button" variant="outline" aria-expanded={choosing}
                  aria-controls={id + '-chooser'} onClick={() => setChoosing(!choosing)}
                >
                  <Search size={15}/>{t('Choose')}
                </Button>
              </div>
              {choosing && (
                <InstancePicker
                  id={id + '-chooser'} scope={{ sourceKey, sessionId }} onClose={closeChooser}
                  onChoose={serverName => {
                    edit({ serverName })
                    closeChooser()
                  }}
                />
              )}
            </div>
            <div className={styles.accounts}>
              <fieldset className={styles.account}>
                <legend><KeyRound size={15}/>{t('Windows credentials')}</legend>
                <label>
                  {t('Username')}
                  <Input
                    value={draft.windowsUsername} required={draft.enabled} maxLength={512} placeholder={'DOMAIN\\user'}
                    autoComplete="off" onChange={event => edit({ windowsUsername: event.target.value })}
                  />
                </label>
                <label>
                  {t('Password')}
                  <Input
                    type="password" autoComplete="new-password" value={draft.windowsPassword} maxLength={4096}
                    required={draft.enabled && !windowsSaved} placeholder={windowsSaved ? t('Keep saved password') : undefined}
                    aria-describedby={replacingSqlAccount ? id + '-replace' : undefined}
                    onChange={event => edit({ windowsPassword: event.target.value })}
                  />
                </label>
                {replacingSqlAccount && (
                  <p className={styles.status} id={id + '-replace'}>{t('Re-enter the Windows password to use this account for SQL connections.')}</p>
                )}
              </fieldset>
              <fieldset className={styles.account}>
                <legend><Database size={15}/>{t('SQL credentials')}</legend>
                <label>
                  {t('Account')}
                  <select
                    value={separate ? 'separate' : 'machine'}
                    onChange={event => edit({ sqlAuth: event.target.value === 'machine' ? 'machine' : 'windows', sqlPassword: '' })}
                  >
                    <option value="machine">{t('Use the Windows account above')}</option>
                    <option value="separate">{t('Use a separate account')}</option>
                  </select>
                </label>
                {separate && (
                  <>
                    <label>
                      {t('Username')}
                      <Input
                        value={draft.sqlUsername} required={draft.enabled} autoComplete="off" maxLength={512}
                        onChange={event => edit({ sqlUsername: event.target.value })}
                      />
                    </label>
                    <label>
                      {t('Password')}
                      <Input
                        type="password" autoComplete="new-password" value={draft.sqlPassword} maxLength={4096}
                        required={draft.enabled && !sqlSaved} placeholder={sqlSaved ? t('Keep saved password') : undefined}
                        onChange={event => edit({ sqlPassword: event.target.value })}
                      />
                    </label>
                    <label className={styles.check}>
                      <input
                        type="checkbox" checked={draft.sqlAuth === 'sql'}
                        onChange={event => edit({ sqlAuth: event.target.checked ? 'sql' : 'windows', sqlPassword: '' })}
                      />
                      {t('SQL authentication')}
                    </label>
                  </>
                )}
              </fieldset>
            </div>
          </fieldset>
          <footer className={styles.footer}>
            <span className={styles.status} role="status">
              {saved && <><Check size={15}/>{t('Saved')}</>}
              {saving && !loading && <><Loader2 size={15} className="motion-safe:animate-spin"/>{t('Validating staging settings…')}</>}
            </span>
            {dirty && !blocked && <Button type="button" variant="ghost" onClick={reset}>{t('Reset')}</Button>}
            <Button type="submit" disabled={blocked || !valid || !dirty}>{t('Save Changes')}</Button>
          </footer>
        </form>
      )}
    </section>
  )
}

type PickerProps = { id: string; scope: Scope; onChoose: (value: string) => void; onClose: () => void }

function InstancePicker({ id, scope, onChoose, onClose }: PickerProps) {
  const { t, diagnostic } = useRecoveryPresentation()
  const [servers, setServers] = useState<string[]>()
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [refresh, setRefresh] = useState(0)
  const { sessionId, sourceKey } = scope

  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal
    const context = { sessionId, sourceKey }
    setError('')
    setServers(undefined)

    async function discover() {
      const first = await command<Task>(context, 'stagingChoose', {}, signal)
      const result = await follow(context, first, signal)
      if (result.status !== 'choices') throw Error(t('VBR could not verify this recovery request.'))
      if (!signal.aborted) setServers(result.servers)
    }

    discover().catch(err => {
      if (!signal.aborted) setError(err instanceof Error ? err.message : t('Validation failed.'))
    })
    return () => controller.abort()
  }, [sourceKey, sessionId, refresh, t])

  const visible = servers?.filter(value => value.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <div id={id} className={styles.chooser} role="region" aria-label={t('Browse instances')}>
      <div className={styles.chooserHeading}>
        <strong>{t('Browse instances')}</strong>
        <Button variant="ghost" size="sm" type="button" onClick={onClose}>{t('Close')}</Button>
      </div>
      {error ? (
        <div className={styles.feedback} role="alert">
          <span>{stagingMessages.has(error) ? t(error) : diagnostic(error)}</span>
          <Button variant="outline" size="sm" type="button" onClick={() => setRefresh(value => value + 1)}>{t('Retry')}</Button>
        </div>
      ) : !servers ? (
        <p role="status" className={styles.status}>
          <Loader2 size={15} className="motion-safe:animate-spin"/>{t('Loading SQL instances…')}
        </p>
      ) : (
        <>
          {servers.length > 5 && (
            <Input type="search" value={query} aria-label={t('Search')} placeholder={t('Search')} onChange={event => setQuery(event.target.value)}/>
          )}
          {visible?.length ? (
            <ul>
              {visible.map(server => (
                <li key={server}>
                  <button type="button" onClick={() => onChoose(server)}><Database size={15}/>{server}</button>
                </li>
              ))}
            </ul>
          ) : (
            <p role="status" className={styles.status}>{query ? t('No results') : t('No SQL instances were reported. Enter the instance name manually.')}</p>
          )}
        </>
      )}
    </div>
  )
}
