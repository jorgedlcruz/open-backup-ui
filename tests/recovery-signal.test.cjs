// Open Backup UI v1.0.2
const fs = require('node:fs')
const ts = require('typescript')
const test = require('node:test')
const assert = require('node:assert/strict')
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
}).outputText, file)
const {shuffledCycle, workshopCaptions, workshopFrame} = require('../lib/restore-points/workshop-animation.ts')

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

test('animation frames keep the artwork dimensions fixed and reverse the packet only after acknowledgement', () => {
  const devices = ['computer','tape','disk']
  for (const device of devices) {
    const art = new Set()
    for (let tick=0; tick<8; tick++) {
      const frame = workshopFrame(device,tick,false)
      const reply = workshopFrame(device,tick,true)
      for (const [part,width] of [['source',10],['server',12]]) {
        const rows = frame[part].split('\n')
        assert.equal(rows.length,5)
        assert(rows.every(row=>row.length===width && /^[ -~]+$/.test(row)))
      }
      art.add(frame.source)
      assert.equal(frame.link.split('\n')[2].indexOf('>'),tick)
      assert.equal(reply.link.split('\n')[2].indexOf('<'),7-tick)
      assert.equal(workshopFrame(device,tick+8,false).server,frame.server)
    }
    assert(art.size>=3)
  }
})
