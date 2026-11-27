'use client'
// Open Backup UI v1.3.0

import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ExternalLink } from 'lucide-react'
import { useI18n } from '@/components/providers/i18n-provider'
import { useReleaseStatus } from '@/components/settings/use-release-status'
import { APP_VERSION } from '@/lib/version'
import ops from '@/components/operations/operations.module.css'

export default function UpdatesPage() {
  const { t } = useI18n()
  const status = useReleaseStatus(true)
  const release = status?.release
  const state = status?.state
  const captions = {
    available: t('Update available'), current: t('You’re up to date'), ahead: t('This installation is ahead of the latest release.'),
    empty: t('No stable release has been published.'), unavailable: t('Release information is unavailable.'),
  }
  return <div className={ops.console}>
    <header className={ops.header}><h1>{t('Updates')}</h1></header>
    <section className="max-w-4xl space-y-5 rounded-xl border bg-card p-5 sm:p-6">
      <dl className="grid grid-cols-2 gap-4">
        <div><dt className="text-sm text-muted-foreground">{t('Installed version')}</dt><dd className="mt-1 text-xl font-semibold">v{APP_VERSION}</dd></div>
        <div><dt className="text-sm text-muted-foreground">{t('Latest release')}</dt><dd className="mt-1 text-xl font-semibold">{release?.tag ?? '—'}</dd></div>
      </dl>
      <p role="status" className="border-t pt-4 text-sm">{state ? captions[state] : t('Checking for updates…')}
        {state === 'unavailable' && release && <> {t('Showing the last available release information.')}</>}
      </p>
    </section>
    {release && <section className="mt-5 max-w-4xl space-y-5 rounded-xl border bg-card p-5 sm:p-6">
      {release.highlights.length > 0 && <div>
        <h2 className="mb-3 text-base font-semibold">{t('Highlights')}</h2>
        <ul className="list-outside list-disc space-y-2 pl-5 text-sm">{release.highlights.map((line, index) => <li key={index}>{line}</li>)}</ul>
      </div>}
      <details className="rounded-md border px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold">{t('Release notes')}</summary>
        <div className="mt-4 space-y-3 overflow-x-auto break-words text-sm leading-relaxed [&_a]:underline [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3">
          {release.notes ? <Markdown skipHtml disallowedElements={['img']} remarkPlugins={[remarkGfm]}
            urlTransform={href => {
              try {
                const url = new URL(href, `https://github.com/jorgedlcruz/open-backup-ui/blob/${encodeURIComponent(release.tag)}/`)
                return url.protocol === 'https:' ? url.href : ''
              } catch { return '' }
            }}
            components={{ a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <>{children}</> }}
          >{release.notes}</Markdown> : t('No release notes were published.')}
        </div>
      </details>
      <a className="inline-flex items-center gap-2 text-sm underline" href={release.url} target="_blank" rel="noopener noreferrer">
        {t('View release on GitHub')}<ExternalLink size={14} aria-hidden="true" />
      </a>
    </section>}
  </div>
}
