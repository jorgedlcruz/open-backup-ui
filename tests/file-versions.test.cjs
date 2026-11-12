// Open Backup UI v1.2.0
const test = require('node:test')
const assert = require('node:assert/strict')
const { sourceHeader, stampSource } = require('../scripts/file-versions.cjs')

test('release stamping preserves executable directives and Windows line endings across version bumps', () => {
  const input = '\uFEFF#!/usr/bin/env node\r\n"use strict";\r\nrun()\r\n'
  const first = stampSource(input,sourceHeader('scripts/demo.cjs','1.0.2'))
  assert.equal(first,'\uFEFF#!/usr/bin/env node\r\n"use strict";\r\n// Open Backup UI v1.0.2\r\nrun()\r\n')
  assert.equal(stampSource(first,sourceHeader('scripts/demo.cjs','1.0.2')),first)
  assert.equal(stampSource(first,sourceHeader('scripts/demo.cjs','1.0.3')),first.replace('v1.0.2','v1.0.3'))
  assert.equal(sourceHeader('package-lock.json','1.0.2'),null)
  assert.equal(sourceHeader('public/example.png','1.0.2'),null)
})
