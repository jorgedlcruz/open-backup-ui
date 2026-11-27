// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { test } = require('node:test')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const resolve = Module._resolveFilename
Module._resolveFilename = function (id, ...args) {
  return resolve.call(this, id.startsWith('@/') ? path.join(root, id.slice(2)) : id, ...args)
}
const compile = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, file)
require.extensions['.ts'] = require.extensions['.tsx'] = compile
require.extensions['.css'] = mod => { mod.exports = {} }
const { I18nProvider } = require('../components/providers/i18n-provider.tsx')
const { EntraInventorySnapshot } = require('../components/entra-inventory/entra-inventory-page.tsx')

function render(overrides = {}) {
  const data = {
    sourceKey: 'source', sourceName: 'VBR', fetchedAt: '2026-07-11T12:00:00Z',
    tenantInventoryComplete: true, jobsAvailable: true, jobsComplete: true,
    jobStatesAvailable: true, jobStatesComplete: true, restorePointsAvailable: true,
    backupJobCount: 0, latestRestorePoint: null, tenants: [], warnings: [], ...overrides,
  }
  return renderToStaticMarkup(React.createElement(I18nProvider, { initialLocale: 'en', initialPreference: 'en' },
    React.createElement(EntraInventorySnapshot, { data })))
}

test('an empty confirmed inventory and unavailable backup evidence have different states', () => {
  const empty = render()
  assert.match(empty, /No tenants are registered on this VBR server/)
  assert.match(empty, /No restore points reported/)
  assert.doesNotMatch(empty, /\/vbr\/jobs\/create-entraid/)
  const unknown = render({ tenantInventoryComplete: false, jobsAvailable: false, jobsComplete: false,
    backupJobCount: null, restorePointsAvailable: false, warnings: ['jobsUnavailable', 'restorePointsUnavailable'] })
  assert.doesNotMatch(unknown, /No tenants are registered|No restore points reported/)
  assert.match(unknown, /Unknown/)
  assert.match(unknown, /Unavailable/)
})

test('the tenant job result remains distinct from a platform-level restore point', () => {
  const tenant = { id: 'registration-id', azureTenantId: 'directory-id', name: null, description: 'Operations',
    cacheRepositoryId: 'cache-id', cacheRepositoryName: 'Cache A', region: 'Worldwide',
    backupJobs: [{id: 'job-1',name: 'Directory job'}],
    lastRun: {jobId:'job-1',jobName:'Directory job',result:'Failed',time:'2026-07-11T03:00:00Z'} }
  const html = render({tenants:[tenant],backupJobCount:1, latestRestorePoint:{id:'point-1',name:'Available restore point',creationTime:'2026-07-10T03:00:00Z'}})
  const metric = html.match(/<section[^>]*aria-label="Latest restore point"[\s\S]*?<\/section>/)?.[0]
  assert.ok(metric)
  assert.match(metric, /Available restore point/)
  assert.doesNotMatch(metric, /Failed|Success/)
  const table = html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0]
  assert.match(table, /Operations/)
  assert.match(table, /directory-id/)
  assert.match(table, /\/vbr\/jobs\/job-1/)
  assert.match(table, /Failed/)
  assert.match(table, /2026-07-11T03:00:00Z/)
})
