// Open Backup UI v1.0.2
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const ts = require('typescript')
const { test } = require('node:test')
const assert = require('node:assert/strict')

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename)

const { translate } = require('../lib/i18n/model.ts')
const { enumLabel } = require('../lib/i18n/presentation.ts')
const { inventoryDiagnostic, protectedRepositoryLabel, virtualContextLabel, virtualFacetLabel } = require('../lib/protected-data/presentation.ts')
const { vbrError } = require('../lib/i18n/vbr-errors.ts')
const { buildVirtualRows, defaultVirtualFilters, facetValue, matchesVirtual } = require('../lib/virtual-infrastructure/model.ts')
const messages = require('../lib/i18n/messages/es.json')
const t = (source, values) => translate(messages, source, values)
const number = value => new Intl.NumberFormat('es', { useGrouping: 'always' }).format(value)

test('live inventory type and platform enums use UI labels while product names remain intact', () => {
  const render = (source, values) => `localized:${translate({}, source, values)}`
  const cases = {
    Directory: 'Directory', WindowsPhysical: 'Windows physical machine', LinuxPhysical: 'Linux physical machine',
    LinuxPhysicalPpc: 'Linux PowerPC physical machine', UnstructuredData: 'Unstructured data',
    EntraIdTenant: 'Microsoft Entra ID tenant', FileServerShare: 'File share', SanVolume: 'SAN volume',
  }
  for (const [raw, expected] of Object.entries(cases)) assert.equal(enumLabel(render, raw), `localized:${expected}`)
  assert.equal(enumLabel(render, 'EntraID'), 'Microsoft Entra ID')
  assert.equal(enumLabel(render, 'VSphere'), 'VMware vSphere')
  assert.equal(enumLabel(render, 'HyperV'), 'Microsoft Hyper-V')
  assert.equal(enumLabel(render, 'VMware'), 'VMware')
  assert.equal(enumLabel(render, 'FuturePlatform'), 'FuturePlatform')
})

test('inventory diagnostics translate known application messages and preserve unknown provider text', () => {
  const known = 'Matching backup objects exist. This does not establish job coverage or recovery-point freshness.'
  assert.notEqual(inventoryDiagnostic(t, known), known)
  assert.equal(inventoryDiagnostic(t, known), messages[known])
  for (const external of [
    'Vendor error 8442: Success on server-alpha',
    'Unknown collector unavailable. Access denied by provider.',
    'prefix The source did not honor the latest-point limit. suffix',
  ]) assert.equal(inventoryDiagnostic(t, external), external)
  const reason = 'Vendor error 8442: server-alpha {name} $&'
  assert.equal(inventoryDiagnostic(t, `Backup inventory unavailable. ${reason}`), t('{section} unavailable. {reason}', {
    section: t('Backup inventory'), reason,
  }))
})

test('anchored collection notices preserve captured server names and localize counts', () => {
  const name = 'srv-{section}-$&-Success.example'
  const section = t('Inventory for {name}', { name })
  for (const suffix of ['Only loaded records are included.', 'Counts cover loaded records only.']) {
    const result = inventoryDiagnostic(t, `Inventory for ${name}: partial collection. ${suffix}`)
    assert.equal(result, t('{section}: partial collection. Only loaded records are included.', { section }))
    assert.ok(result.includes(name))
  }
  assert.equal(inventoryDiagnostic(t, '12345 conflicting file identities were excluded from storage accounting.', number),
    t('{count} conflicting file identities were excluded from storage accounting.', { count: number(12345) }))
})

test('virtual context localizes missing values without translating actual names or metadata', () => {
  const missing = {
    item: {},
    manager: { key: 'unknown', name: 'Not reported' },
    datacenter: { key: 'unknown', name: 'Not reported' },
    cluster: { key: 'unknown', name: 'Not reported' },
    host: { key: 'unknown', name: 'Not reported' },
  }
  for (const field of ['manager', 'datacenter', 'cluster', 'host', 'dns', 'os']) {
    assert.equal(virtualContextLabel(t, missing, field), t('Not reported'))
    assert.notEqual(virtualContextLabel(t, missing, field), 'Not reported')
  }
  const present = {
    ...missing,
    item: { hostName: 'Not reported', metadata: [{ field: 'dnsName', data: 'Not reported' }, { field: 'guestOsName', data: 'Not reported' }] },
    host: { key: 'actual-host-id', name: 'Not reported' },
    datacenter: { key: 'actual-datacenter-id', name: 'Success' },
    cluster: { key: 'actual-cluster-id', name: 'Unknown' },
  }
  const before = JSON.stringify(present)
  for (const field of ['manager', 'host', 'dns', 'os']) assert.equal(virtualContextLabel(t, present, field), 'Not reported')
  assert.equal(virtualContextLabel(t, present, 'datacenter'), 'Success')
  assert.equal(virtualContextLabel(t, present, 'cluster'), 'Unknown')
  assert.equal(JSON.stringify(present), before)
})

test('repository labels distinguish missing metadata from an actual sentinel-shaped name', () => {
  assert.equal(protectedRepositoryLabel(t, { object: {}, backup: null }), t('Not reported'))
  const named = { object: { repositoryName: 'Not reported' }, backup: null }
  const before = JSON.stringify(named)
  assert.equal(protectedRepositoryLabel(t, named), 'Not reported')
  assert.equal(protectedRepositoryLabel(t, { object: {}, backup: { repositoryName: 'Success' } }), 'Success')
  const id = '00000000-0000-4000-8000-000000000001'
  assert.equal(protectedRepositoryLabel(t, { object: { repositoryId: id }, backup: null }), id)
  assert.equal(JSON.stringify(named), before)
})

test('virtual filter labels translate enums and missing context while retaining raw filter values and source names', () => {
  const snapshot = {
    sourceName: 'source', fetchedAt: '2026-10-27T00:00:00Z', apiRevision: '1.3-rev2', warnings: [],
    inventory: { available: true, complete: true, data: [
      { type: 'VirtualMachine', platform: 'VSphere', hostName: 'Not reported', name: 'vm-1', objectId: 'vm-1', powerState: 'PoweredOff', metadata: [{ field: 'guestOsName', data: 'Not reported' }] },
      { type: 'VirtualMachine', platform: 'VSphere', name: 'vm-2', objectId: 'vm-2' },
    ] },
    backups: { available: true, complete: true, data: [] },
  }
  const rows = buildVirtualRows(snapshot), before = JSON.stringify(rows)
  const [named, missing] = rows
  assert.equal(virtualFacetLabel(t, named, 'platform'), 'VMware vSphere')
  assert.equal(virtualFacetLabel(t, named, 'type'), t('Virtual machine'))
  assert.equal(virtualFacetLabel(t, named, 'power'), t('Stopped'))
  assert.equal(virtualFacetLabel(t, named, 'manager'), 'Not reported', 'A source name must not be mistaken for the absence label')
  assert.equal(virtualFacetLabel(t, named, 'os'), 'Not reported', 'A provider OS value stays literal')
  for (const field of ['manager', 'datacenter', 'cluster', 'host', 'os']) assert.equal(virtualFacetLabel(t, missing, field), t('Not reported'), field)
  assert.equal(facetValue(missing, 'host'), 'unknown')
  assert.equal(facetValue(named, 'power'), 'Stopped')
  assert.equal(matchesVirtual(named, { ...defaultVirtualFilters, facets: { power: ['Stopped'], platform: ['VSphere'] } }), true)
  assert.equal(matchesVirtual(named, { ...defaultVirtualFilters, facets: { power: [t('Stopped')] } }), false)
  assert.equal(JSON.stringify(rows), before)
  const french = (key, values) => translate(require('../lib/i18n/messages/fr.json'), key, values)
  assert.notEqual(virtualFacetLabel(french, named, 'power'), virtualFacetLabel(t, named, 'power'), 'The presenter must use the current locale')
})

test('known VBR errors localize at the display boundary without rewriting provider diagnostics', () => {
  const trace = key => `localized:${key}`
  const exact = 'Your VBR session has expired. Reconnect your data source.'
  assert.equal(vbrError(trace, exact), `localized:${exact}`)
  assert.equal(inventoryDiagnostic(trace, exact), `localized:${exact}`)
  assert.equal(vbrError(trace, 'Unauthorized'), 'localized:Authorization required')
  assert.equal(vbrError(trace, 'VEEAM_API_URL not configured'), 'localized:VBR API URL is not configured.')
  assert.equal(vbrError(trace, 'Loading took too long. Retry or narrow the source environment.'), 'localized:Loading took too long. Retry or narrow the source environment.')
  for (const vendor of ['Veeam API Error: 503 - VendorError 8442', `Vendor: ${exact}`, `${exact} Vendor details`, 'Internal Server Error: provider service']) {
    assert.equal(vbrError(trace, vendor), vendor)
    assert.equal(inventoryDiagnostic(trace, vendor), vendor)
  }
})
