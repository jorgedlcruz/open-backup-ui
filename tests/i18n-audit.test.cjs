// Open Backup UI v1.0.2
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { createAudit, auditProject, missingTranslations } = require('../scripts/audit-i18n.cjs')
const root = path.resolve(__dirname, '..')
const fixtureRoot = path.resolve(__dirname, 'i18n-audit-fixture')
const auditFixture = source => createAudit(fixtureRoot, [[path.join(fixtureRoot, 'components/example.tsx'), source]])

test('the source audit catches omitted copy, conditional accessibility labels and templates without translating API data or technical props', () => {
  const result = auditFixture(`
    const options = [{ value: 'backup', label: 'Backup workloads' }]
    const nodeOptions = { ariaLabel: 'Inspect map node' }
    const payload = { description: 'API payload data must remain literal' }
    function Example({ row, busy }) {
      return <div className="layout-grid" data-state="loading" id="example">
        <h1>Untranslated heading</h1>
        <input placeholder="Find a repository" aria-label={busy ? 'Loading repositories' : 'Search repositories'} />
        <button title={\`Inspect \${row.name}\`}>{row.name}</button>
        <p>{row.username}</p><p>{row.error}</p><p>{row.error || 'Connection unavailable'}</p>
        <span>Microsoft 365</span><code>npm run build</code><pre>{'certificate-content'}</pre>
        <a href="/vbr/jobs" aria-describedby="technical-id">Jobs</a>
        <input placeholder="backup.example.com" />
      </div>
    }`)
  const values = new Set(result.findings.map(item => item.text))
  for (const value of ['Untranslated heading', 'Find a repository', 'Loading repositories', 'Search repositories', 'Inspect {value1}', 'Connection unavailable', 'Backup workloads', 'Jobs', 'Inspect map node']) assert.ok(values.has(value), value)
  for (const value of ['layout-grid', 'loading', 'example', 'row.name', 'row.username', 'row.error', 'Microsoft 365', 'npm run build', 'certificate-content', '/vbr/jobs', 'technical-id', 'backup.example.com', 'API payload data must remain literal']) assert.ok(!values.has(value), value)
  assert.ok(result.findings.every(item => item.line > 0 && item.path === 'components/example.tsx'))
})

test('implicit translation contracts are qualified by implementation and a translated use cannot hide a separate raw render', () => {
  const result = auditFixture(`
    import { Panel as TranslatedPanel } from '@/components/investigation/shared'
    import { Panel as RawPanel } from '@/components/one-reports/shared'
    const columns = [{ label: 'Shared column heading' }]
    function Example() {
      return <><TranslatedPanel title="Translated panel title" />
        <RawPanel title="Untranslated panel title" />
        {columns.map(column => <th>{t(column.label)}</th>)}
        {columns.map(column => <th>{column.label}</th>)}
      </>
    }`)
  assert.ok(result.registrations.some(item => item.key === 'Translated panel title' && item.kind === 'implicit-prop'))
  assert.ok(!result.registrations.some(item => item.key === 'Untranslated panel title'))
  assert.ok(result.findings.some(item => item.text === 'Untranslated panel title' && item.kind === 'ui-prop'))
  assert.ok(result.findings.some(item => item.text === 'Shared column heading' && item.kind === 'render-expression'))
})

test('translation aliases, Trans, implicit search labels and translated configuration are registered rather than reported as omissions', () => {
  const result = auditFixture(`
    import { useI18n, Trans as Text } from '@/components/providers/i18n-provider'
    import { SearchBox } from '@/components/investigation/shared'
    import { FilterWorkspace } from '@/components/operations/filter-workspace'
    const columns = [{ id: 'source', name: 'Source name' }]
    const states = { ready: 'Ready to connect', blocked: 'Connection blocked' }
    function Example({ state }) {
      const { t: uiText } = useI18n()
      return <><Text>Translated heading</Text><Text>{'Translated paragraph'}</Text>
        <input placeholder={uiText('Search sources')} />
        <span>{uiText(states[state])}</span>
        {columns.map(column => <th>{uiText(column.name)}</th>)}
        <SearchBox label="Search source inventory" />
        <FilterWorkspace label="Source inventory filters" />
      </>
    }`)
  const registered = new Set(result.registrations.map(item => item.key))
  for (const key of ['Translated heading', 'Translated paragraph', 'Search sources', 'Ready to connect', 'Connection blocked', 'Source name', 'Search source inventory', 'Source inventory filters']) assert.ok(registered.has(key), key)
  assert.deepEqual(result.findings, [])
  const catalogs = { en: { 'Search sources': 'Search sources' }, es: { 'Search sources': 'Buscar fuentes' } }
  const missing = missingTranslations(result.registrations, catalogs)
  assert.ok(missing.some(item => item.key === 'Translated heading' && item.locales.includes('en')), 'Missing English entries must be detected, not just catalog parity')
  assert.ok(!missing.some(item => item.key === 'Search sources'))
})

const projectAudit = auditProject(root)
test('every explicit UI translation and app-authored diagnostic registry key exists in every shipped language', () => {
  assert.ok(projectAudit.files > 100, 'The audit must cover app and component sources, not a hand-selected page')
  assert.ok(projectAudit.registrations.length > 500, 'Translations should be discovered from source')
  assert.deepEqual([...projectAudit.missing, ...projectAudit.implicitMissing].map(item => `${item.path}:${item.line}: ${item.key} [${item.locales.join(', ')}]`), [])
})

test('Data Sources has no untranslated static JSX, UI properties, or resolved UI label configuration', () => {
  const findings = projectAudit.findings.filter(item => item.path.startsWith('components/data-sources/'))
  assert.deepEqual(findings, [])
  const registrations = projectAudit.registrations.filter(item => item.path.startsWith('components/data-sources/'))
  assert.ok(registrations.some(item => item.key === 'Data Sources'))
  assert.ok(registrations.some(item => item.key === 'Check connection for {name}'))
  assert.ok(registrations.some(item => item.key === 'All configurations'))
})

test('migrated VBR widgets, inventories and policy editors have no untranslated interface copy', () => {
  const domains = /^components\/(?:protected-data|virtual-infrastructure|forecast|ransomware|topology|lens|operations|job-builder)\//
  const technicalLabels = new Set(['VMware vSphere', 'Microsoft Hyper-V', '· API', 'Lens:'])
  const findings = projectAudit.findings.filter(item => domains.test(item.path) && !technicalLabels.has(item.text))
  assert.deepEqual(findings, [])
  for (const domain of ['protected-data', 'virtual-infrastructure', 'forecast', 'ransomware', 'topology', 'lens', 'operations', 'job-builder']) {
    assert.ok(projectAudit.registrations.some(item => item.path.startsWith(`components/${domain}/`)), `${domain} must register its UI copy`)
  }
  assert.ok(projectAudit.registrations.some(item => item.path === 'lib/forecast/presentation.ts' && item.kind === 'message-registry'))
  assert.ok(projectAudit.registrations.some(item => item.path === 'lib/protected-data/presentation.ts'))
})

test('active Entra ID and Backup Copy creation routes have no untranslated static interface copy', () => {
  const routes = /^app\/\(app\)\/vbr\/jobs\/(?:create-entraid|create-backup-copy)\//
  assert.deepEqual(projectAudit.findings.filter(item => routes.test(item.path)), [])
  assert.ok(projectAudit.registrations.some(item => routes.test(item.path) && item.key === 'Finish & Create'))
})

function loadPresentation() {
  const filename = path.join(root, 'lib/data-sources/presentation.ts')
  const compiled = new Module(filename, module)
  compiled.filename = filename
  compiled.paths = module.paths
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename)
  return compiled.exports
}
const { sourceMessage, sourceMessages } = loadPresentation()
const translated = (source, values = {}) => `translated:${source.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`))}`

test('Data Sources translates only registered app-authored diagnostics and preserves HTTP status codes', () => {
  const exact = 'Run a connection check to verify API access.'
  assert.ok(sourceMessages.includes(exact))
  assert.equal(sourceMessage(translated, exact), `translated:${exact}`)
  const http = 'The source returned HTTP 503. It is reachable, but API access could not be verified.'
  assert.equal(sourceMessage(translated, http), `translated:${http}`)
  const auth = 'Authentication was not accepted (HTTP 401). Check credentials, permissions and any MFA requirements.'
  assert.equal(sourceMessage(translated, auth), `translated:${auth}`)
  assert.equal(sourceMessage(translated, `${exact} ${auth}`), `translated:${exact} translated:${auth}`)
})

test('Data Sources preserves vendor diagnostics and mixed known/unknown evidence verbatim', () => {
  const known = 'The API is reachable and requires authentication.'
  const vendor = 'Backup server prod-01 reports VendorError 8442 for account EXAMPLE\\operator.'
  for (const value of [vendor, `${known} ${vendor}`, `${vendor} ${known}`, 'The source returned HTTP unexpected. It is reachable, but API access could not be verified.']) assert.equal(sourceMessage(translated, value), value)
})
