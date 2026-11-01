"use client"

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, Globe2, KeyRound, Loader2, LockKeyhole, RefreshCw, ShieldCheck, Upload } from 'lucide-react'
import { useI18n } from '@/components/providers/i18n-provider'
import { LOCALES, type LocalePreference } from '@/lib/i18n/model'
import { applicationRequest } from '@/lib/api/application-request'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Panel } from '@/components/investigation/shared'
import { cn } from '@/lib/utils'
import ops from '@/components/operations/operations.module.css'
import styles from './settings.module.css'
import { LabsSettings } from '@/components/labs/labs-settings'

type Certificate = {
    subject: string; issuer: string; subjectAltName: string; validFrom: string; validTo: string;
    fingerprint256: string; selfSigned: boolean; daysRemaining: number;
}
type TlsStatus = {
    mode: 'managed' | 'external'; uploadsEnabled: boolean; certificate: Certificate | null;
    reloadSupported: boolean; httpsPort: number | null;
}

export function SettingsConsole() {
    const { t } = useI18n()
    return <div className={cn(ops.console, styles.page)}>
        <header className={ops.header}>
            <div><h1>{t('Application settings')}</h1><p>{t('Choose your language and manage secure access to this console.')}</p></div>
        </header>
        <Tabs defaultValue="language">
            <TabsList aria-label={t('Application settings')} className={styles.tabs}>
                <TabsTrigger value="language"><Globe2 size={15} />{t('Language & region')}</TabsTrigger>
                <TabsTrigger value="https"><LockKeyhole size={15} />{t('HTTPS & certificates')}</TabsTrigger>
                <TabsTrigger value="labs">{t('Labs')}</TabsTrigger>
            </TabsList>
            <TabsContent value="language"><LanguageSettings /></TabsContent>
            <TabsContent value="https"><CertificateSettings /></TabsContent>
            <TabsContent value="labs"><LabsSettings /></TabsContent>
        </Tabs>
    </div>
}

function LanguageSettings() {
    const { t, locale, preference, setLocale, formatDate, formatNumber } = useI18n()
    // Browser and Node ICU versions can differ in date punctuation. Format the
    // sample after hydration instead of making the initial HTML inconsistent.
    const [mounted, setMounted] = useState(false)
    useEffect(() => setMounted(true), [])
    const selected = LOCALES.find(item => item.code === locale)
    return <div className={styles.workspace}>
        <Panel title={t('Interface language')} subtitle={t('Apply a language instantly. Your preference is saved in this browser.')}>
            <div className={styles.panelBody}>
                <div className={styles.field}><label htmlFor="interface-language">{t('Language')}</label>
                    <select id="interface-language" value={preference} onChange={event => setLocale(event.target.value as LocalePreference)}>
                        <option value="auto">{t('Automatic (browser language)')}</option>
                        {LOCALES.map(item => <option key={item.code} value={item.code} lang={item.code}>{item.nativeName} · {item.name}</option>)}
                    </select>
                </div>
                <div className={styles.applied} role="status"><Check size={16} /><span>{t('Active language')}: <strong lang={locale}>{selected?.nativeName}</strong></span></div>
                <p className={styles.hint}>{t('Translations are included with the app. No text or backup data is sent to a translation service.')}</p>
                <p className={styles.hint}>{t('Product names, workload names, and messages from your backup servers remain as reported. Untranslated interface text falls back to English.')}</p>
            </div>
        </Panel>
        <Panel title={t('Formatting preview')} subtitle={t('Numbers and dates follow the selected language in localized views.')}>
            <dl className={styles.preview}>
                <div><dt>{t('Number')}</dt><dd>{mounted ? formatNumber(1234567.89) : '—'}</dd></div>
                <div><dt>{t('Date and time')}</dt><dd>{mounted ? formatDate(new Date('2026-10-27T14:30:00Z'), { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }) : '—'} <small>UTC</small></dd></div>
                <div><dt>{t('Status')}</dt><dd><span className={styles.applied}><ShieldCheck size={16} />{t('Healthy')}</span></dd></div>
            </dl>
        </Panel>
    </div>
}

function CertificateSettings() {
    const { t, formatDate, formatNumber } = useI18n()
    const [status, setStatus] = useState<TlsStatus | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [revision, setRevision] = useState(0)
    const [busy, setBusy] = useState(false)
    const [token, setToken] = useState('')
    const [certificate, setCertificate] = useState<File | null>(null)
    const [privateKey, setPrivateKey] = useState<File | null>(null)
    const [chain, setChain] = useState<File | null>(null)
    const form = useRef<HTMLFormElement>(null)

    useEffect(() => {
        const abort = new AbortController()
        setLoading(true)
        applicationRequest<TlsStatus>('/api/settings/tls', { signal: abort.signal })
            .then(value => { if (!abort.signal.aborted) { setStatus(value); setError('') } })
            .catch(problem => { if (!abort.signal.aborted) setError(problem instanceof Error ? problem.message : 'HTTPS settings could not be loaded.') })
            .finally(() => { if (!abort.signal.aborted) setLoading(false) })
        return () => abort.abort()
    }, [revision])

    async function install(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!certificate || !privateKey || !status?.uploadsEnabled || busy) return
        setBusy(true); setError(''); setNotice('')
        try {
            if ([certificate, privateKey, chain].some(file => file && (file.size > 65536 || file.size === 0))) {
                throw new Error('Each PEM file must be nonempty and no larger than 64 KiB.')
            }
            if (privateKey.size > 32768) throw new Error('Private keys must be no larger than 32 KiB.')
            const [certificatePem, privateKeyPem, chainPem] = await Promise.all([certificate.text(), privateKey.text(), chain?.text()])
            const result = await applicationRequest<{ success: boolean; certificate: Certificate }>('/api/settings/tls', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HTTPS-Admin-Token': token },
                body: JSON.stringify({ certificatePem, privateKeyPem, ...(chainPem ? { chainPem } : {}) }),
            })
            if (!result.success) throw new Error('The certificate could not be applied.')
            setStatus(current => current ? { ...current, certificate: result.certificate } : current)
            setNotice('Certificate installed. New HTTPS connections now use it; no application restart was needed.')
        } catch (problem) {
            setError(problem instanceof Error ? problem.message : 'The certificate could not be applied.')
        } finally {
            setToken(''); setPrivateKey(null); setCertificate(null); setChain(null)
            form.current?.reset()
            setBusy(false)
        }
    }

    const cert = status?.certificate
    return <div className={styles.certificatePage}>
        <div className={styles.statusBar}>
            <div><LockKeyhole size={17} /><strong>{loading ? t('Loading…') : !status ? t('Unavailable') : status.mode === 'managed' ? t('Managed HTTPS') : t('External HTTPS or HTTP')}</strong></div>
            <Button size="sm" variant="outline" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} />{t('Refresh')}</Button>
        </div>
        {error && <div role="alert" className={styles.error}>{t(error)}</div>}
        {notice && <div role="status" className={styles.success}><Check size={16} />{t(notice)}</div>}
        <div className={styles.workspace}>
            <Panel title={t('Active certificate')} subtitle={t('The certificate presented by the built-in HTTPS listener.')}>
                <div className={styles.panelBody}>
                    {loading ? <p role="status" className={styles.hint}>{t('Loading…')}</p> : cert ? <>
                        <span className={cn(styles.certificateState, cert.daysRemaining < 30 && styles.expiring)}>{cert.selfSigned ? t('Self-signed') : t('CA-issued')} · {t('{days} days remaining', { days: formatNumber(cert.daysRemaining) })}</span>
                        <dl className={styles.details}>
                            <div><dt>{t('Subject')}</dt><dd>{cert.subject}</dd></div>
                            <div><dt>{t('Issuer')}</dt><dd>{cert.issuer}</dd></div>
                            <div><dt>{t('Hostnames')}</dt><dd>{cert.subjectAltName || t('Not reported')}</dd></div>
                            <div><dt>{t('Valid from')}</dt><dd>{formatDate(new Date(cert.validFrom), { dateStyle: 'medium', timeStyle: 'short' })}</dd></div>
                            <div><dt>{t('Expires')}</dt><dd>{formatDate(new Date(cert.validTo), { dateStyle: 'medium', timeStyle: 'short' })}</dd></div>
                            <div><dt>{t('SHA-256 fingerprint')}</dt><dd className={styles.fingerprint}>{cert.fingerprint256}</dd></div>
                        </dl>
                        {cert.selfSigned && <p className={styles.hint}>{t('Self-signed certificates encrypt traffic, but browsers will warn until the certificate is trusted on each device.')}</p>}
                    </> : <p className={styles.hint}>{t(status ? 'No certificate is managed by this application process. If a reverse proxy provides HTTPS, manage its certificate there.' : 'HTTPS settings could not be loaded.')}</p>}
                    {status?.mode === 'managed' && !status.uploadsEnabled && <p className={styles.hint}>{t('Certificate uploads are disabled. Configure HTTPS_ADMIN_TOKEN on the server to enable them.')}</p>}
                </div>
            </Panel>
            <Panel title={t('Replace certificate')} subtitle={t('Validate and apply a matching certificate and private key.')}>
                <form ref={form} onSubmit={install} className={styles.panelBody}>
                    <fieldset disabled={!status?.uploadsEnabled || busy || loading} className={styles.fields}>
                        <label className={styles.field}><span>{t('Server certificate (PEM)')}</span><Input type="file" accept=".pem,.crt,.cer" required onChange={event => setCertificate(event.target.files?.[0] ?? null)} /></label>
                        <label className={styles.field}><span>{t('Private key (PEM)')}</span><Input type="file" accept=".pem,.key" required onChange={event => setPrivateKey(event.target.files?.[0] ?? null)} /><small>{t('Use an unencrypted private key matching the certificate. It is never returned by the API.')}</small></label>
                        <label className={styles.field}><span>{t('Intermediate CA chain (optional)')}</span><Input type="file" accept=".pem,.crt,.cer" onChange={event => setChain(event.target.files?.[0] ?? null)} /><small>{t('This completes the server certificate chain. It does not change trust for connections to Veeam servers.')}</small></label>
                        <label className={styles.field}><span>{t('HTTPS administrator token')}</span><Input type="password" autoComplete="off" value={token} minLength={32} maxLength={512} required onChange={event => setToken(event.target.value)} /><small>{t('Enter the HTTPS_ADMIN_TOKEN configured on this server. It is not saved in your browser.')}</small></label>
                        <Button type="submit" size="sm" disabled={busy || !certificate || !privateKey || token.length < 32}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}{busy ? t('Applying…') : t('Validate & apply certificate')}</Button>
                    </fieldset>
                    <p className={styles.hint}>{t('Invalid certificates are rejected before activation. The current certificate remains active if validation fails.')}</p>
                </form>
            </Panel>
        </div>
        {status?.mode === 'external' && <Panel title={t('Enable built-in HTTPS')} subtitle={t('Start the HTTPS launcher on the server after building the application.')}>
            <div className={styles.panelBody}>
                <p className={styles.hint}>{t('Set HTTPS_HOSTNAMES to the DNS names or IP addresses you use to open this app, and set a strong HTTPS_ADMIN_TOKEN of at least 32 characters.')}</p>
                <pre className={styles.command}>npm run build{String.fromCharCode(10)}npm run start:https</pre>
                <p className={styles.hint}>{t('On first startup, a unique self-signed certificate is generated and stored in data/tls. HTTPS uses port 3443 by default. OpenSSL is required for automatic generation.')}</p>
                <p className={styles.hint}><KeyRound size={14} /> {t('Keep the data directory private and persistent. Never include certificates or private keys in a release archive or container image.')}</p>
            </div>
        </Panel>}
    </div>
}
