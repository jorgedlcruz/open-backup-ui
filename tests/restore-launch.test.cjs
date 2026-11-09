// Open Backup UI v1.0.2
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file)
const path = require.resolve('../lib/restore-points/launch.ts')
const { restoreActivityUrl, restoreOperations } = require('../lib/restore-points/workflow.ts')
const sourceKey = '1'.repeat(64)
const id = '11111111-1111-4111-8111-111111111111'
function freshClient() {
  delete require.cache[path]
  return require(path)
}
function newTab() {
  let value
  global.sessionStorage = { getItem: () => value, setItem: (_, next) => { value = next } }
  return freshClient()
}

test('every supported operation hands off its exact session, and observers never resubmit', async () => {
  const launch = newTab()
  for (const operation of restoreOperations) {
    const draft = { sourceKey, restorePointId: id, backupId: id, operation, mode: 'OriginalLocation' }
    let calls = 0, resolve
    const request = launch.beginRestoreLaunch(draft, 'VM A', undefined, input => {
      assert.equal(input, draft)
      calls++
      return new Promise(ready => { resolve = ready })
    })
    const first = launch.observeRestoreLaunch(request.requestId)
    const remount = launch.observeRestoreLaunch(request.requestId)
    await Promise.resolve()
    assert.equal(calls, 1)
    assert.equal(launch.readRestoreLaunch(request.requestId).phase, 'starting')
    const refreshed = freshClient()
    assert.equal((await refreshed.observeRestoreLaunch(request.requestId)).phase, 'unknown')
    const mountErrors = [{type:'Mount', message:'One disk could not be mounted'}]
    resolve({ id, sourceKey, mountErrors })
    assert.deepEqual(await first, await remount)
    const receipt = await refreshed.observeRestoreLaunch(request.requestId)
    assert.equal(receipt.sessionId, id)
    assert.deepEqual(receipt.mountErrors, mountErrors)
    assert.equal(refreshed.findSessionLaunch(sourceKey, id).sourceKey, sourceKey)
    assert.equal(refreshed.findSessionLaunch('a'.repeat(64), id), undefined)
    assert.equal(restoreActivityUrl(receipt.sessionId, receipt.sourceKey), '/vbr/activity/' + id + '?sourceKey=' + sourceKey)
    assert.equal(calls, 1)
  }
})

test('lost responses and mismatched sources remain unconfirmed, while explicit rejections preserve their reason', async () => {
  const launch = newTab()
  for (const [outcome, phase] of [
    [() => Promise.reject(new TypeError('Network failure')), 'unknown'],
    [() => Promise.reject(Object.assign(new Error('Lost confirmation'), {uncertain: true})), 'unknown'],
    [async () => ({id, sourceKey:'a'.repeat(64)}), 'unknown'],
    [async () => ({sourceKey}), 'unknown'],
    [async () => { throw new Error('The selected target changed.') }, 'rejected'],
  ]) {
    const request = launch.beginRestoreLaunch({ sourceKey, restorePointId:id, backupId:id, operation:'StartFlrRestore', mode:'OriginalLocation' }, 'VM', undefined, outcome)
    const result = await launch.observeRestoreLaunch(request.requestId)
    assert.equal(result.phase, phase)
    assert.equal(result.sessionId, undefined)
    if (phase === 'rejected') assert.equal(result.message, 'The selected target changed.')
  }
})
