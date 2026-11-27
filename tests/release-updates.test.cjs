// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const ts = require('typescript')
const { test } = require('node:test')
const assert = require('node:assert/strict')

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename)
const { parseRelease, releaseState } = require('../lib/updates/releases.ts')
const { createReleaseReader } = require('../lib/updates/release-service.ts')

const payload = { tag_name: 'v1.10.0', prerelease: false, draft: false, body: '## Highlights\n\n- **Faster** browsing\n- New settings\n\n## Other\n- Documentation' }
const published = { status: 200, text: JSON.stringify(payload), headers: { etag: '"revision"' } }

test('only stable releases with a newer semantic version produce notifications', () => {
  assert.equal(releaseState('1.9.9', 'v1.10.0'), 'available')
  assert.equal(releaseState('1.10.0', 'v1.10.0+build.2'), 'current')
  assert.equal(releaseState('1.10.0-rc.1', 'v1.10.0'), 'available')
  assert.equal(releaseState('2.0.0', 'v1.10.0'), 'ahead')
  for (const fields of [{ draft: true }, { prerelease: true }, { tag_name: 'v2.0.0-rc.1' }, { tag_name: '../malformed' }]) {
    assert.equal(parseRelease({ ...payload, ...fields }), null)
  }
})

test('digest keeps published notes and links only to the validated official release tag', () => {
  const result = parseRelease({ ...payload, html_url: 'https://invalid.example/' })
  assert.deepEqual(result.highlights, ['Faster browsing', 'New settings'])
  assert.equal(result.notes, payload.body)
  assert.equal(result.url, 'https://github.com/jorgedlcruz/open-backup-ui/releases/tag/v1.10.0')
  assert.deepEqual(parseRelease({ ...payload, body: null }).highlights, [])
  assert.deepEqual(parseRelease({ ...payload, body: '```sh\n- example command\n```\n- Actual feature' }).highlights, ['Actual feature'])
})

test('metadata checks only contact the official HTTPS address with certificate verification and a deadline', async t => {
  const { EventEmitter } = require('node:events')
  let actual
  t.mock.method(require('node:https'), 'get', (url, options) => {
    actual = { url, options }
    const request = new EventEmitter()
    process.nextTick(() => request.emit('error', new Error('Fixture offline')))
    return request
  })
  const result = await createReleaseReader()('1.3.0')
  assert.equal(result.state, 'unavailable')
  assert.equal(actual.url, 'https://api.github.com/repos/jorgedlcruz/open-backup-ui/releases/latest')
  assert.equal(actual.options.rejectUnauthorized, true)
  assert.equal(actual.options.agent, false)
  assert.ok(actual.options.signal instanceof AbortSignal)
  assert.equal(actual.options.headers.Authorization, undefined)
})

test('parallel reads share one request and revalidate once per hour with the ETag', async () => {
  let time = 0
  const seen = []
  const read = createReleaseReader(async tag => {
    seen.push(tag)
    return tag ? { status: 304, headers: {}, text: '' } : published
  }, () => time)
  const [first, second] = await Promise.all([read('1.2.0'), read('1.10.0')])
  assert.equal(first.state, 'available')
  assert.equal(second.state, 'current')
  time += 3_599_999
  assert.deepEqual(await read('1.2.0'), first)
  assert.deepEqual(seen, [undefined])
  time += 1
  assert.deepEqual(await read('1.2.0'), first)
  assert.deepEqual(seen, [undefined, '"revision"'])
})

test('unavailable checks keep the last known notes and honor GitHub rate-limit backoff', async () => {
  let time = 0
  const responses = [published, { status: 429, text: '', headers: { 'retry-after': '1800' } }, { status: 404, headers: {}, text: '' }]
  const read = createReleaseReader(async () => responses.shift(), () => time)
  await read('1.2.0')
  time += 3_600_000
  const failed = await read('1.2.0')
  assert.equal(failed.state, 'unavailable')
  assert.equal(failed.release.notes, payload.body)
  time += 1_799_999
  assert.deepEqual(await read('1.2.0'), failed)
  time++
  assert.deepEqual(await read('1.2.0'), { installed: '1.2.0', state: 'empty', release: null })
})

test('a failed first check is unavailable and never claims the installation is up to date', async () => {
  const read = createReleaseReader(async () => { throw new Error('TLS failed') })
  assert.deepEqual(await read('1.2.0'), { installed: '1.2.0', state: 'unavailable', release: null })
})
