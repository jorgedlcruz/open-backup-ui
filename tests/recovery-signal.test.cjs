// Open Backup UI v1.2.0
const fs = require('node:fs')
const ts = require('typescript')
const test = require('node:test')
const assert = require('node:assert/strict')
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
}).outputText, file)
const {shuffledCycle, workshopCaptions} = require('../lib/restore-points/workshop-animation.ts')

test('the workshop has 200 distinct, compact captions', () => {
  assert.equal(workshopCaptions.length, 200)
  assert.equal(new Set(workshopCaptions.map(caption => caption.toLocaleLowerCase())).size, 200)
  assert(workshopCaptions.every(caption => caption.trim() === caption && caption.length > 0 && caption.length <= 90))
})

test('the workshop shows every caption before recycling and avoids a repeat across shuffle boundaries', () => {
  let seed = 41
  const next = shuffledCycle(workshopCaptions, () => {
    seed = (1664525 * seed + 1013904223) >>> 0
    return seed / 4294967296
  })
  let previous
  for (let i=0; i<50; i++) {
    const draw = Array.from({length:workshopCaptions.length}, next)
    assert.notEqual(draw[0], previous)
    assert.deepEqual([...draw].sort(), [...workshopCaptions].sort())
    previous = draw.at(-1)
  }
})
