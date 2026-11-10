// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename)

const { planningMessage, planningMessages, localizedPolicy, localizedSchedule, localizedFull } = require('../lib/forecast/presentation.ts')
const { topologyText, topologyName, topologyFact, topologyFactLabel } = require('../lib/topology/presentation.ts')
const { buildTopology } = require('../lib/topology/model.ts')
const { ransomwareDescription, ransomwareLabel, activityName, activitySessionName } = require('../lib/ransomware/presentation.ts')
const { evidenceText, evidenceMessages, evidenceSectionNames, evidenceCollectionTemplates } = require('../lib/forecast/evidence-presentation.ts')
const { translate } = require('../lib/i18n/model.ts')
const messages = JSON.parse(fs.readFileSync(path.join(__dirname, '../lib/i18n/messages/es.json'), 'utf8'))
const t = (key, values) => translate(messages, key, values)

test('topology translates missing-entity names without translating matching real resource names', () => {
  const trace = source => `translated:${source}`
  const graph = buildTopology({ objects: [], jobs: [], repositories: [], memberships: [], backups: [
    {id:'b1',name:'Backup one',jobId:'j1',repositoryId:'r1'},
    {id:'b2',name:'Backup two',repositoryId:'r2',repositoryName:'Repository details unavailable'},
  ] })
  assert.equal(topologyName(trace, graph.entities.find(row => row.sourceId==='j1')), 'translated:Job details unavailable')
  assert.equal(topologyName(trace, graph.entities.find(row => row.sourceId==='r1')), 'translated:Repository details unavailable')
  assert.equal(topologyName(trace, graph.entities.find(row => row.sourceId==='r2')), 'Repository details unavailable')
})

test('topology details format raw numeric evidence in the selected locale without parsing display strings', () => {
  const german = (value, options) => new Intl.NumberFormat('de', options).format(value)
  const graph = buildTopology({objects:[{id:'o1',name:'VM',restorePointsCount:12345}],jobs:[],repositories:[{id:'r1',name:'Repo',capacityGB:1000,freeGB:123.5}],memberships:[],backups:[]})
  const repo = graph.entities.find(row=>row.sourceId==='r1')
  const before = structuredClone(graph)
  assert.equal(topologyFact(t, repo.facts[0], german), '87,7 %')
  assert.equal(topologyFact(t, {...repo.facts[1],value:'ambiguous server locale'}, german), '123,5 GB')
  assert.equal(topologyFact(t, graph.entities.find(row=>row.sourceId==='o1').facts[1], german), '12.345')
  assert.equal(topologyText(t, '12345 restore points', german), '12.345 puntos de restauración')
  assert.equal(topologyFactLabel(source=>'translated:'+source,'Free space'), 'translated:Free space')
  assert.deepEqual(graph,before)
})

test('missing ransomware names translate only when their original source fields were absent', () => {
  const trace = source => `translated:${source}`
  assert.equal(activityName(trace,{event:{machine:{displayName:'Workload not reported'}}}), 'Workload not reported')
  assert.equal(activityName(trace,{event:{machine:{}}}), 'translated:Workload not reported')
  assert.equal(activityName(trace,{indicator:{task:{name:'Workload not reported'}}}), 'Workload not reported')
  assert.equal(activityName(trace,{indicator:{task:{}}}), 'translated:Workload not reported')
  assert.equal(activitySessionName(trace,{indicator:{sessionName:'Session name not reported'}}), 'Session name not reported')
  assert.equal(activitySessionName(trace,{indicator:{sessionName:'Session name not reported',sessionNameMissing:true}}), 'translated:Session name not reported')
})

test('forecast policy labels translate units, weekdays and full schedules without modifying API values', () => {
  const policy = {
    isDisabled: false,
    schedule: { runAutomatically: true, daily: { isEnabled: true, dailyKind: 'SelectedDays', days: ['Monday', 'Friday'] } },
    storage: { retentionPolicy: { quantity: 14, type: 'Days' }, advancedSettings: { syntheticFulls: { isEnabled: true, weekly: { days: ['Sunday'] } }, activeFulls: { isEnabled: false } } },
  }
  const before = structuredClone(policy)
  assert.equal(localizedPolicy(t, policy), '14 días')
  assert.equal(localizedSchedule(t, policy), 'Lunes, Viernes')
  assert.equal(localizedFull(t, policy), 'Sintética: Domingo')
  assert.deepEqual(policy, before)
})

test('planning templates translate counts and nested reasons while preserving unrecognized diagnostics', () => {
  assert.equal(planningMessage(t, '14 days · hardened repository'), '14 días · repositorio reforzado')
  assert.equal(planningMessage(t, 'No restore point in 9 days'), 'Sin puntos de restauración en 9 días')
  assert.equal(planningMessage(t, '2 files excluded from the scenario: Daily schedule is incomplete.'), '2 archivos excluidos del escenario: La programación diaria está incompleta.')
  const vendor = 'Server prod-01 returned VendorError 8442 for EXAMPLE\\operator.'
  assert.equal(planningMessage(t, vendor), vendor)
  assert.equal(planningMessage(t, `Daily schedule is incomplete ${vendor}`), `Daily schedule is incomplete ${vendor}`)
  assert.equal(planningMessage(t, 'No restore point in unknown days'), 'No restore point in unknown days')
})

test('every registered planning description is translated in every shipped catalog', () => {
  const folder = path.join(__dirname, '../lib/i18n/messages')
  for (const name of fs.readdirSync(folder).filter(name => name.endsWith('.json'))) {
    const catalog = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'))
    for (const message of planningMessages) assert.ok(catalog[message]?.trim(), `${name}: ${message}`)
  }
})

test('topology and security labels translate known statuses without changing unknown identifiers', () => {
  assert.equal(topologyText(t, '9 restore points'), '9 puntos de restauración')
  assert.equal(topologyText(t, 'job'), t('Job'))
  assert.equal(topologyText(t, 'VSphereBackup'), t('VMware backup'))
  assert.equal(ransomwareLabel(t, 'FalsePositive'), 'Falso positivo')
  assert.equal(ransomwareLabel(t, 'critical'), t('Critical'))
  const labelKeys = []
  const recordKey = key => { labelKeys.push(key); return key }
  ransomwareLabel(recordKey, 'MalwareExtensions')
  ransomwareLabel(recordKey, 'InternalVeeamDetector')
  assert.deepEqual(labelKeys, ['Malware file extensions', 'Internal Veeam detector'])
  assert.equal(topologyText(t, 'VendorStateX84'), 'VendorStateX84')
  assert.equal(ransomwareLabel(t, 'VendorEngineX84'), 'VendorEngineX84')
})

test('ransomware translates its own heuristic, retaining native event details verbatim', () => {
  const native = { kind: 'event', event: { details: 'No job reference' }, details: 'No job reference' }
  assert.equal(ransomwareDescription(t, native), 'No job reference', 'A provider message must not be mistaken for application UI')
  assert.equal(ransomwareDescription(t, { kind: 'event', event: {} }), 'Descripción no comunicada')
  const indicator = { kind: 'heuristic', indicator: { dedupeRatio: 0.96 } }
  assert.equal(ransomwareDescription(t, indicator), 'Baja reducción de datos: se transfirió el 96.0 % de los bytes leídos. Revisa la compresión, el cifrado y los cambios de las cargas.')
  const formatSpanish = (value, options) => new Intl.NumberFormat('es', options).format(value)
  assert.equal(ransomwareDescription(t, indicator, formatSpanish), 'Baja reducción de datos: se transfirió el 96,0 % de los bytes leídos. Revisa la compresión, el cifrado y los cambios de las cargas.')
  assert.equal(ransomwareDescription(t, native, formatSpanish), 'No job reference')
})

test('loader diagnostics translate only known anchored templates and preserve names literally', () => {
  const trace = (key, values = {}) => `translated:${key.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`))}`
  assert.equal(evidenceText(trace, 'Repository states: partial collection.'), 'translated:translated:Repository states: partial collection.')
  assert.equal(evidenceText(trace, 'Files for prod {count} $&: partial collection.'), 'translated:translated:Files for prod {count} $&: partial collection.')
  assert.equal(evidenceText(trace, 'Malware events unavailable. Read access was denied.'), 'translated:translated:Malware events unavailable. translated:Read access was denied.')
  assert.equal(evidenceText(trace, 'Workload membership could not be loaded for 3 backup(s). Some connections are unknown.'), 'translated:Workload membership could not be loaded for 3 backup(s). Some connections are unknown.')
  for (const unknown of [
    'VendorStream: partial collection.',
    'Malware events unavailable. VendorError 8442 on prod-01.',
    'Workload membership could not be loaded for unknown backup(s). Some connections are unknown.',
    'prefix Repository states: partial collection.',
  ]) assert.equal(evidenceText(trace, unknown), unknown)
})

test('registered loader diagnostics, labels and collection templates are present in every language', () => {
  const keys = [...evidenceMessages, ...evidenceSectionNames, ...evidenceCollectionTemplates.map(([, key]) => key)]
  const folder = path.join(__dirname, '../lib/i18n/messages')
  for (const name of fs.readdirSync(folder).filter(name => name.endsWith('.json'))) {
    const catalog = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'))
    for (const key of keys) assert.ok(catalog[key]?.trim(), `${name}: ${key}`)
  }
})
