// Open Backup UI v1.0.2
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { collectSourceFiles, packageSource, buildZip, verifyZip } = require('../scripts/package-source.cjs')
const { prepareReleaseNotes } = require('../scripts/prepare-release-notes.cjs')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'open-backup-release-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  function write(relative, value) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, value)
  }
  write('package.json', JSON.stringify({ name: 'open-backup-ui', version: '1.0.0' }))
  for (const file of ['package-lock.json', 'README.md', 'LICENSE']) write(file, file)
  return { root, write }
}

test('source ZIP includes app, translations, release screenshots and public assets while excluding local state', t => {
  const { root, write } = fixture(t)
  const included = ['.env.example', '.github/workflows/release.yml', 'app/page.tsx', 'lib/i18n/messages/es.json', 'docs/releases/images/v1.0.0/theme.webp', 'public/images/connect/localized.webp', 'scripts/https-server.cjs']
  const excluded = ['.env', '.env.local', 'data/connections.json', 'node_modules/dep/index.js', '.next/cache/item', '.codex-attachments/private.png', '.tmp-draft.json', 'tmp/debug.txt', 'artifacts/old.zip', 'docs/.env', 'public/private.key', 'scripts/build.log']
  for (const file of [...included, ...excluded]) write(file, Buffer.from([0, 255, 10, 44]))
  const files = collectSourceFiles(root)
  for (const file of included) assert.ok(files.includes(file), `${file} is included`)
  for (const file of excluded) assert.ok(!files.includes(file), `${file} is excluded`)
  const first = packageSource(root)
  const second = packageSource(root, path.join(root, 'tmp', 'second'))
  assert.equal(first.sha256, second.sha256)
  assert.equal(first.images, 2)
  assert.ok(fs.readFileSync(first.path).equals(fs.readFileSync(second.path)))
  assert.equal(fs.readFileSync(`${first.path}.sha256`, 'utf8'), `${first.sha256}  open-backup-ui-v1.0.0.zip\n`)
})

test('archive verification detects corrupted content and rejects unsafe entry paths', () => {
  const entries = [{ name: 'open-backup-ui-v1.0.0/binary.bin', content: Buffer.from([0, 255, 5]) }]
  const archive = buildZip(entries)
  verifyZip(archive, entries)
  const corrupt = Buffer.from(archive)
  corrupt[30 + Buffer.byteLength(entries[0].name)] ^= 1
  assert.throws(() => verifyZip(corrupt, entries), /integrity/)
  assert.throws(() => buildZip([{ name: '../outside', content: Buffer.alloc(0) }]), /Unsafe archive path/)
})

test('GitHub release Markdown resolves images and documents against the release tag', t => {
  const { root, write } = fixture(t)
  write('docs/releases/images/v1.0.0/theme.webp', 'image')
  write('docs/i18n.md', '# Languages')
  write('docs/releases/v1.0.0.md', '![Theme](images/v1.0.0/theme.webp)\n[Languages](../i18n.md#coverage)\n[README](../../README.md)\n[External](https://example.org/page)\n[Here](#section)')
  const result = prepareReleaseNotes(root, 'v1.0.0', 'jorgedlcruz/open-backup-ui')
  assert.match(result, /https:\/\/raw\.githubusercontent\.com\/jorgedlcruz\/open-backup-ui\/v1\.0\.0\/docs\/releases\/images\/v1\.0\.0\/theme\.webp/)
  assert.match(result, /https:\/\/github\.com\/jorgedlcruz\/open-backup-ui\/blob\/v1\.0\.0\/docs\/i18n\.md#coverage/)
  assert.match(result, /\[External\]\(https:\/\/example\.org\/page\)/)
  assert.match(result, /\[Here\]\(#section\)/)
  write('docs/releases/v1.0.0.md', '[Missing](missing.md)')
  assert.throws(() => prepareReleaseNotes(root, 'v1.0.0', 'jorgedlcruz/open-backup-ui'), /does not exist/)
  write('docs/releases/v1.0.0.md', '[Outside](../../../outside.md)')
  assert.throws(() => prepareReleaseNotes(root, 'v1.0.0', 'jorgedlcruz/open-backup-ui'), /leaves the source tree/)
})
