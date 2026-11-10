// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createAudit } = require('../scripts/audit-i18n.cjs')
const root = path.resolve(__dirname, '..')
const folder = path.join(root, 'app/(app)/vbr/jobs/create-backup-copy')

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename)
const filename = path.join(folder, '_components/presentation.ts')
const compiled = new Module(filename, module)
compiled.filename = filename
compiled.paths = module.paths
compiled.require = request => request.startsWith('@/') ? require(path.join(root, request.slice(2))) : require(request)
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename)
const { backupCopyMessage } = compiled.exports

test('backup-copy validation and known application errors translate while provider diagnostics stay literal', () => {
  const t = value => `localized:${value}`
  for (const key of ['Job name cannot be empty', 'A job with this name already exists', 'Failed to create Backup Copy Job', 'Failed to load source jobs.', 'Your VBR session has expired. Reconnect your data source.']) {
    assert.equal(backupCopyMessage(t, key), `localized:${key}`)
  }
  const provider = 'Veeam error 8442: BackupCopy rejected for source {name} $&'
  assert.equal(backupCopyMessage(t, provider), provider)
})

test('all four backup-copy steps and source selection register their static UI copy', () => {
  const paths = ['page.tsx', '_components/create-backup-copy-wizard.tsx', '_components/source-job-selector.tsx', '_components/presentation.ts']
  const audit = createAudit(root, paths.map(file => [path.join(folder, file), fs.readFileSync(path.join(folder, file), 'utf8')]))
  assert.deepEqual(audit.findings, [])
  const keys = new Set(audit.registrations.map(item => item.key))
  for (const key of ['Create Backup Copy Job', 'Source Backup Jobs', 'Target Repository & Retention', 'Review & Complete', '{count} backup jobs selected', '{weekly} weekly, {monthly} monthly, {yearly} yearly', 'The backup copy job “{name}” has been created and enabled.', 'Eligible Jobs']) assert.ok(keys.has(key), key)
})

test('localizing backup-copy presentation does not translate native job settings or resource identity', () => {
  const file = path.join(folder, '_components/create-backup-copy-wizard.tsx')
  const source = fs.readFileSync(file, 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let payload
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'payload') payload = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(payload && ts.isObjectLiteralExpression(payload))
  const calls = []
  const inspect = node => { if (ts.isCallExpression(node)) calls.push(node.expression.getText(ast)); ts.forEachChild(node, inspect) }
  inspect(payload)
  assert.deepEqual(calls, ['selectedJobs.map'], 'No display translation belongs inside the API payload')
  const inputs = { name: 'Success', description: 'Keep {name} $&', selectedJobs: [{ name: 'Warning', id: 'source-id', type: 'VSphereBackup' }], repositoryId: 'repo-id', retentionDays: 14, gfsEnabled: true, gfsWeekly: 2, gfsMonthly: 3, gfsYearly: 4 }
  const before = JSON.stringify(inputs)
  const build = new Function(...Object.keys(inputs), `return (${payload.getText(ast)})`)
  const result = build(...Object.values(inputs))
  assert.equal(result.type, 'BackupCopy')
  assert.equal(result.mode, 'Immediate')
  assert.equal(result.name, inputs.name)
  assert.equal(result.description, inputs.description)
  assert.deepEqual(result.sourceObjects.includes.jobs, inputs.selectedJobs)
  assert.equal(result.target.backupRepositoryId, inputs.repositoryId)
  assert.deepEqual(result.target.retentionPolicy, { type: 'Days', quantity: 14 })
  assert.equal(result.target.gfsPolicy.weekly.desiredTime, 'Sunday')
  assert.equal(result.target.gfsPolicy.monthly.desiredTime, 'First')
  assert.equal(result.target.gfsPolicy.yearly.desiredTime, 'January')
  assert.equal(JSON.stringify(inputs), before)
})
