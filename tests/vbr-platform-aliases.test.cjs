// Open Backup UI v1.3.0
const fs = require('node:fs')
const test = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true},
}).outputText, filename)
const {normalizeVbrPlatform} = require('../lib/vbr/platform.ts')
const {activityQuerySchema, sessionPlatforms} = require('../lib/activity/filters.ts')
const {loadActivity} = require('../lib/activity/load.ts')
const {objectSchema, backupSchema, backupKey, rowsFrom, matches, defaults} = require('../lib/protected-data/model.ts')
const {loadProtectedRecoveryTimes} = require('../lib/protected-data/load.ts')
const {pointSchema} = require('../lib/restore-points/cached-collection.ts')
const {supportedApplications} = require('../lib/recovery/application-eligibility.ts')
const {enumLabel} = require('../lib/i18n/presentation.ts')

const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const groups = [
  {forms: ['AWSEC2', 'EC2', 'AWS'], canonical: 'AWSEC2', display: 'Amazon EC2'},
  {forms: ['GCE', 'GoogleCloud'], canonical: 'GCE', display: 'Google Compute Engine'},
]
const rights = new Set(['ViewBackupObjects', 'ViewRestorePoints', 'ViewTasks', 'StartExplorerForMsSql'])
const operation = {operation: 'ExploreForMsSql', enabled: true}

test('v13 cloud backup object discriminators, filter links and display names share stable GA identities', () => {
  for (const {forms, canonical, display} of groups) {
    assert.deepEqual(sessionPlatforms.filter(p => forms.includes(p)), [canonical])
    for (const platformName of forms) {
      const object = {id: id(1), backupId: id(2), platformName}
      assert.equal(objectSchema.parse(object).platformName, canonical)
      assert.equal(backupSchema.parse(object).platformName, canonical)
      assert.equal(pointSchema.parse(object).platformName, canonical)
      assert.equal(activityQuerySchema.parse({platform: platformName}).platform, canonical)
      const [cached] = rowsFrom({data: [object], backups: {data: []}, latest: {}})
      assert.equal(cached.object.platformName, canonical)
      assert.ok(matches(cached, {...defaults, platforms: [platformName]}))
      assert.equal(enumLabel(s => s, platformName), display)
    }
  }
  for (const value of [null, undefined, 'NewCloud', 'VMware']) assert.equal(normalizeVbrPlatform(value), value)
  assert.equal(objectSchema.parse({id: id(1), platformName: 'NewCloud'}).platformName, 'NewCloud')
})

test('session filtering includes all matching response spellings without changing the rev2 wire request', async () => {
  const rows = ['EC2', 'AWSEC2', 'AWS', 'GoogleCloud', 'GCE', 'VMware'].map((platformName, index) =>
    ({id: id(index + 1), name: 'Session', platformName, creationTime: '2026-11-01T01:00:00Z'}))
  const read = async (path, revision) => {
    const url = new URL(path, 'https://example.invalid')
    assert.equal(revision, '1.3-rev2')
    assert.equal([...url.searchParams.keys()].some(k => k.toLowerCase().includes('platform')), false)
    const data = url.pathname === '/private-api/v1/sessions' ? rows : []
    return {data, pagination: {total: data.length}}
  }
  for (const {forms, canonical} of groups) {
    const feed = await loadActivity(read, 'Backup server', 'test', activityQuerySchema.parse({platform: forms.at(-1)}))
    assert.equal(feed.total, forms.length)
    assert.deepEqual(feed.rows.map(r => r.session.platformName), forms.map(() => canonical))
  }
})

test('mixed-revision restore point evidence must still identify the selected backup and logical platform', async () => {
  const creationTime = '2026-11-01T01:00:00Z'
  for (const [stored, reported, expected] of [['EC2','AWS','verified'], ['AWS','AWSEC2','verified'],
    ['GoogleCloud','GCE','verified'], ['AWS','GCE','unavailable']]) {
    const object = {id: id(1), backupId: id(2), platformName: stored}
    const response = await loadProtectedRecoveryTimes(async () => ({data: [
      {id: id(3), backupId: object.backupId, platformName: reported, creationTime},
    ]}), {warnings: [], data: [object], apiRevision: '1.3-rev2'}, new Date('2026-11-02T01:00:00Z'))
    assert.equal(response.latest[backupKey(object)].state, expected)
  }
})

test('cloud spelling aliases preserve the advertised operation, archive and permission requirements', () => {
  for (const platformName of groups.flatMap(g => g.forms)) {
    const row = {objectId: id(1), backupId: id(2), platformName, operations: [operation]}
    assert.deepEqual(supportedApplications(row, rights), [{kind: 'sql', objectId: row.objectId}])
    assert.deepEqual(supportedApplications({...row, operations: [{...operation, enabled: false}]}, rights), [])
    assert.deepEqual(supportedApplications({...row, repositoryType: 'ArchiveTier'}, rights), [])
    assert.deepEqual(supportedApplications(row, new Set()), [])
  }
  assert.deepEqual(supportedApplications({objectId: id(1), platformName: 'Unknown', operations: [operation]}, rights), [])
})
