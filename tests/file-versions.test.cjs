// Open Backup UI v1.3.0
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sourceHeader, stampSource, updateVersions } = require('../scripts/file-versions.cjs')

test('release stamping preserves executable directives and Windows line endings across version bumps', () => {
  const input = '\uFEFF#!/usr/bin/env node\r\n"use strict";\r\nrun()\r\n'
  const first = stampSource(input,sourceHeader('scripts/demo.cjs','1.0.2'))
  assert.equal(first,'\uFEFF#!/usr/bin/env node\r\n"use strict";\r\n// Open Backup UI v1.0.2\r\nrun()\r\n')
  assert.equal(stampSource(first,sourceHeader('scripts/demo.cjs','1.0.2')),first)
  assert.equal(stampSource(first,sourceHeader('scripts/demo.cjs','1.0.3')),first.replace('v1.0.2','v1.0.3'))
  assert.equal(sourceHeader('package-lock.json','1.0.2'),null)
  assert.equal(sourceHeader('public/example.png','1.0.2'),null)
})

test('release preparation covers shipping additions and moves before staging and preserves the Git index', t => {
  const scratch = path.resolve(os.tmpdir())
  const root = fs.mkdtempSync(path.join(scratch, 'obu-file-versions-'))
  t.after(() => {
    assert.equal(path.dirname(root), scratch)
    fs.rmSync(root, {recursive:true, force:true})
  })
  function write(file, text) {
    const destination = path.join(root, file)
    fs.mkdirSync(path.dirname(destination), {recursive:true})
    fs.writeFileSync(destination, text)
  }
  function git(...args) {
    return execFileSync('git', ['-c', 'safe.directory=' + root.replaceAll('\\','/'), ...args], {cwd:root, encoding:'utf8'})
  }
  git('init', '--quiet')
  write('app/old.ts', 'export const old = true\n')
  write('tracked.txt', 'tracked root file')
  write('docs/file-versions.json', '{}')
  write('.gitignore', 'app/ignored.ts\n')
  git('add', '--', '.gitignore', 'tracked.txt', 'app/old.ts', 'docs/file-versions.json')
  fs.renameSync(path.join(root, 'app/old.ts'), path.join(root, 'app/new.ts'))
  write('docs/image.png', Buffer.from([1,2,3]))
  write('app/ignored.ts', 'ignore me')
  write('app/private.pfx', 'exclude from source archive')
  write('local-notes.md', 'local root file')
  const index = git('ls-files', '--stage')
  assert.throws(() => updateVersions(root, '1.3.0', true), /out of date/i)
  updateVersions(root, '1.3.0', false)
  assert.deepEqual(updateVersions(root, '1.3.0', true), {files:5, sources:2})
  const manifest = JSON.parse(fs.readFileSync(path.join(root,'docs/file-versions.json'), 'utf8'))
  assert.deepEqual(Object.keys(manifest.files), ['.gitignore','app/new.ts','docs/file-versions.json','docs/image.png','tracked.txt'])
  assert.equal(fs.readFileSync(path.join(root, 'app/ignored.ts'), 'utf8'), 'ignore me')
  assert.equal(git('ls-files', '--stage'), index)
})
