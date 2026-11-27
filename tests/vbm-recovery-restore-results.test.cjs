// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename)
const { combineRestoreResults, restoreResultCounts, restoreItemResults } = require('../lib/vbm-recovery/restore-results.ts')

const message = { id: 'item-id', status: 'Success', name: 'Newsletter', path: 'Jorge/Inbox/test' }
const event = { id: 'event-id', type: 'Restore', status: 'Success', itemName: 'Newsletter', source: 'Jorge/Inbox', target: 'Jorge/Inbox/test' }

test('separates zero reported items from missing, malformed and negative counters', () => {
  assert.deepEqual(restoreResultCounts({totalItemsCount:2, restoredItemsCount:0, failedItemsCount:-2, skippedItemsCount:'0'}), {
    total:2, restored:0, failed:undefined, skipped:undefined,
  })
  assert.equal(restoreResultCounts(null).total, undefined)
})

test('item statistics and a uniquely matching restore event retain the item and event IDs', () => {
  const [row] = restoreItemResults({items:[message]}, [event])
  assert.deepEqual([row.id, row.eventId, row.name, row.result, row.source, row.target],
    ['item-id', 'event-id', 'Newsletter', 'Success', 'Jorge/Inbox', 'Jorge/Inbox/test'])
})

test('ambiguous subjects, paths or repeated events stay separate from statistics', () => {
  for (const [items, events] of [[[message, {...message,id:'second-item'}], [event]], [[message], [event, {...event,id:'retry'}]],
    [[{...message,path:undefined}], [event]], [[{...message,status:'Failed'}], [event]]]) {
    const rows = restoreItemResults({items}, events)
    assert.equal(rows.length, items.length + events.length)
    assert.ok(rows.filter(row => row.origin === 'statistics').every(row => !row.source && !row.target && !row.eventId))
  }
})

test('reports only completed per-item restore events and ignores browsing and session lifecycle events', () => {
  const rows = restoreItemResults(null, [event, {...event,type:'View'}, {...event,itemName:undefined}, {...event,status:'Running'}])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].origin, 'event')
  assert.equal(rows[0].id, undefined)
})

test('folder and full item paths reconcile without altering the original provider or saved audit values', () => {
  const original = [
    {origin:'statistics', id:'stat', name:'Newsletter', result:'Success', path:'Jorge\\Inbox\\Newsletter', warnings:[]},
    {origin:'event', eventId:'event', name:'Newsletter', result:'Success', source:'Jorge/Inbox', target:'Jorge/Restored', warnings:[]},
  ]
  const before = structuredClone(original)
  const rows = combineRestoreResults(original)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].path, 'Jorge\\Inbox\\Newsletter')
  assert.equal(rows[0].source, 'Jorge/Inbox')
  assert.equal(rows[0].target, 'Jorge/Restored')
  assert.deepEqual(original, before)
  const [linked] = rows
  assert.equal(combineRestoreResults([linked, {...original[1], eventId:'another event'}]).length, 2)
})

test('an event that can describe multiple items also prevents picking another event by elimination', () => {
  const items = [message, {...message, id:'second', path:'Jorge/Restored'}]
  const overlapping = {...event, id:'ambiguous', source:message.path, target:items[1].path}
  for (const events of [[overlapping,event], [event,overlapping]]) {
    const rows = restoreItemResults({items}, events)
    assert.equal(rows.length, 4)
    assert.ok(rows.filter(row => row.origin === 'statistics').every(row => !row.eventId))
  }
})

test('a reported single-item total links two matching results even if mailbox path formats differ', () => {
  const stats = {items:[{...message, path:'Jorge de la Cruz'}], totalItemsCount:1}
  const entry = {...event, source:'jorge@example.org/Inbox'}
  const [row, extra] = restoreItemResults(stats, [entry])
  assert.equal(extra, undefined)
  assert.deepEqual([row.id, row.source, row.target], [message.id, entry.source, entry.target])
  assert.equal(restoreItemResults({...stats,totalItemsCount:2}, [entry]).length, 2)
  assert.equal(restoreItemResults(stats, [{...entry,status:'Warning'}]).length, 2)
})

test('retains nested item details, failures, warnings and undirected provider paths', () => {
  const rows = restoreItemResults({items:[{name:'Drive',status:'Warning',childItems:[{...message,
    status:'Failed',error:'Failed to write',warnings:['Unavailable version'],extraneous:'unreported',
  }]}]}, [])
  assert.equal(rows.length, 2)
  assert.equal(rows[1].error, 'Failed to write')
  assert.deepEqual(rows[1].warnings, ['Unavailable version'])
  assert.equal(rows[1].path, message.path)
  assert.equal(rows[1].target, undefined)
  assert.equal(rows[1].source, undefined)
  assert.equal(rows[1].extraneous, undefined)
})
