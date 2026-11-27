// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')
const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions }).outputText, filename)

function cart(ownerEmail, recover = false, authSettings) {
  const fields = [], writes = [], results = [], mountEffects = []
  let cursor, tree
  const useState = initial => {
    const key = cursor++
    if (!(key in fields)) fields[key] = typeof initial === 'function' ? initial() : initial
    return [fields[key], value => { fields[key] = typeof value === 'function' ? value(fields[key]) : value }]
  }
  const file = require.resolve('../components/vbm-recovery/cart.tsx')
  const component = new Module(file, module)
  const receipt = { operations: [{ status: 'accepted', itemKeys: [] }], notice: 'Audit update pending' }
  component.require = name => {
    if (name === 'react') return { useState, useEffect(effect) { if (!tree) mountEffects.push(effect) }, useRef: value => useState({ current: value })[0], useCallback: fn => fn }
    if (name === './client') return {
      recoveryGet: async () => authSettings,
      recoveryPost: async (body, endpoint) => { writes.push({ body, endpoint }); if (recover) throw new Error('Interrupted response'); return receipt },
      recoverReceipt: async () => receipt,
    }
    if (name === './certificate-file') return require('../components/vbm-recovery/certificate-file.ts')
    if (name === './browser') return { ItemIcon: 'icon', itemKey: row => row.id }
    if (name === './microsoft-sign-in') return { MicrosoftSignInStep: 'sign-in' }
    if (name === '@/components/providers/i18n-provider') return { useI18n: () => ({ t: text => text }) }
    if (name === '@/components/ui/button') return { Button: 'button' }
    if (name.endsWith('.css')) return {}
    return require(name)
  }
  component._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions }).outputText, file)
  const props = {
    sessionId: randomUUID(), workload: 'Exchange', mailboxScoped: true,
    entries: [{ id: 'one', kind: 'item', ownerId: 'owner', ownerName: 'Mailbox owner', ownerEmail, name: 'Newsletter' }],
    remove() {}, onSubmitted: (...args) => results.push(args),
  }
  function render() { cursor = 0; tree = component.exports.RecoveryCart(props) }
  function find(test, root = tree) {
    if (!root || typeof root !== 'object') return
    if (test(root)) return root
    for (const child of [root.props?.children].flat(Infinity)) {
      if (!child || typeof child !== 'object') continue
      const found = find(test, child)
      if (found) return found
    }
  }
  function field(label) {
    const parent = find(node => node.type === 'label' && [node.props.children].flat().includes(label))
    assert.ok(parent, label)
    if (parent.props.htmlFor) return find(node => node.props.id === parent.props.htmlFor)
    return find(node => ['select', 'input', 'span'].includes(node.type), parent)
  }
  function change(label, value) { field(label).props.onChange({ target: { value } }); render() }
  function submit() { return find(node => node.type === 'button' && [node.props.children].flat().includes('Start restore')) }
  function certificate() {
    change('Authentication', 'certificate')
    change('Application ID', '11111111-1111-4111-8111-111111111111')
    const fileInput = find(node => node.type === 'input' && node.props.type === 'file')
    fileInput.props.onChange({ currentTarget: { files: [new File([new Uint8Array([1, 2, 3])], 'fixture.pfx')] } })
    render()
  }
  render()
  async function detectSettings() {
    for (const effect of mountEffects.splice(0)) effect()
    await new Promise(resolve => setImmediate(resolve))
    render()
  }
  function organizationDisclosure() {
    return find(node => node.type === 'button' && [node.props.children].flat().includes('Organization and region'))
  }
  return { field, find, change, submit, certificate, props, render, writes, results, receipt, detectSettings, organizationDisclosure }
}

test('a same-mailbox folder survives authentication changes and all direct and recovered receipts carry the notice', async () => {
  for (const recover of [false, true]) {
    const f = cart('Mailbox@EXAMPLE.test', recover)
    f.change('Target folder', 'Open Backup UI restore test')
    f.certificate()
    assert.equal(f.field('Destination').props.value, 'sameMailboxFolder')
    assert.equal(f.field('Target folder').props.value, 'Open Backup UI restore test')
    assert.equal(f.field('Target mailbox').props.children, 'mailbox@example.test')
    f.change('Destination', 'original')
    f.change('Destination', 'sameMailboxFolder')
    assert.equal(f.field('Authentication').props.value, 'certificate')
    assert.equal(f.submit().props.disabled, false)
    f.props.submissionBlocked = true; f.render()
    assert.equal(f.submit().props.disabled, true)
    f.props.submissionBlocked = false; f.render()
    await f.submit().props.onClick()
    assert.equal(f.writes.length, 1)
    const { body, endpoint } = f.writes[0]
    assert.equal(endpoint, undefined)
    assert.equal(body.auth.mode, 'certificate')
    assert.equal(body.options.mailbox, 'mailbox@example.test')
    assert.equal(body.options.destination, 'alternate')
    assert.equal(body.options.originalMailboxFolder, true)
    assert.equal(body.options.folder, 'Open Backup UI restore test')
    assert.deepEqual(f.results, [[f.receipt.operations, f.receipt.notice, body.requestId]])
  }
})

test('unknown source email and a different mailbox both require explicit SMTP and scoped restores stay in one mailbox', () => {
  const f = cart()
  f.change('Target folder', 'Recovered')
  f.certificate()
  assert.equal(f.field('Target mailbox').props.value, '')
  f.change('Target mailbox', 'Mailbox owner')
  assert.equal(f.submit().props.disabled, true)
  f.change('Target mailbox', 'mailbox@example.test')
  assert.equal(f.submit().props.disabled, false)
  f.change('Destination', 'alternate')
  assert.equal(f.field('Target mailbox').props.value, '')
  assert.equal(f.submit().props.disabled, true)
  assert.equal(f.find(node => node.type === 'option' && node.props.value === 'operator'), undefined)
  f.change('Target mailbox', 'other@example.test')
  assert.equal(f.submit().props.disabled, false)
  f.change('Destination', 'sameMailboxFolder')
  assert.equal(f.field('Target mailbox').props.value, 'mailbox@example.test')
  f.change('Authentication', 'deviceCode')
  assert.equal(f.field('Target folder').props.value, 'Recovered')
  assert.ok(f.find(node => node.type === 'option' && node.props.value === 'alternate'))
  f.props.entries = [{ ...f.props.entries[0], ownerId: 'a-different-mailbox' }]
  f.render()
  assert.equal(f.field('Target mailbox').props.value, '')
})

test('ordinary certificate restores submit the detected organization and default region without opening advanced fields', async () => {
  const f = cart('mailbox@example.test', false, { organizationName: 'source.onmicrosoft.com' })
  await f.detectSettings()
  f.certificate()
  f.change('Target folder', 'Recovered')
  assert.equal(f.organizationDisclosure().props['aria-expanded'], false)
  assert.ok(f.find(node => node.type === 'span' && node.props.children === 'source.onmicrosoft.com · Worldwide'))
  assert.equal(f.find(node => node.type === 'input' && node.props.placeholder === 'tenant.onmicrosoft.com'), undefined)
  await f.submit().props.onClick()
  assert.equal(f.writes[0].body.options.organizationName, 'source.onmicrosoft.com')
  assert.equal(f.writes[0].body.options.officeRegion, 'Worldwide')
})

test('alternate cloud settings survive closing the disclosure and apply only to an alternate destination', async () => {
  for (const original of [false, true]) {
    const f = cart('mailbox@example.test', false, { organizationName: 'source.onmicrosoft.com', region: 'China' })
    await f.detectSettings()
    f.certificate()
    f.change('Target folder', 'Recovered')
    f.organizationDisclosure().props.onClick(); f.render()
    assert.equal(f.field('Microsoft 365 region').props.value, 'China')
    f.change('Destination organization', 'other.onmicrosoft.com')
    f.change('Microsoft 365 region', 'USGovernment')
    f.organizationDisclosure().props.onClick(); f.render()
    assert.ok(f.find(node => node.type === 'span' && node.props.children === 'other.onmicrosoft.com · USGovernment'))
    if (original) f.change('Destination', 'original')
    await f.submit().props.onClick()
    assert.equal(f.writes[0].body.options.organizationName, original ? 'source.onmicrosoft.com' : 'other.onmicrosoft.com')
    assert.equal(f.writes[0].body.options.officeRegion, original ? 'China' : 'USGovernment')
  }
})

test('Microsoft sign-in exposes a missing required organization and enables sign-in after entry', async () => {
  const f = cart('mailbox@example.test', false, { applicationId: '11111111-1111-4111-8111-111111111111' })
  await f.detectSettings()
  f.change('Authentication', 'deviceCode')
  assert.equal(f.organizationDisclosure().props['aria-expanded'], true)
  assert.equal(f.field('Destination organization').props.required, true)
  assert.equal(f.find(node => node.type === 'sign-in').props.canRequest, false)
  f.change('Destination organization', 'target.onmicrosoft.com')
  assert.equal(f.organizationDisclosure().props['aria-expanded'], true)
  assert.equal(f.find(node => node.type === 'sign-in').props.canRequest, true)
  f.organizationDisclosure().props.onClick(); f.render()
  assert.equal(f.organizationDisclosure().props['aria-expanded'], false)
})

test('the source-bound folder cannot write to a different mailbox or an owner with no verified address', async () => {
  const { recoveryPost } = require('../lib/vbm-recovery/load.ts')
  for (const email of [undefined, 'actual@example.test']) {
    const writes = [], sessionId = randomUUID()
    const context = {
      scope: randomUUID(), sourceName: 'test', execute: async (path, method = 'GET') => {
        if (method !== 'GET') writes.push(path)
        if (path.endsWith(sessionId)) return { id: sessionId, type: 'Vex', state: 'Working' }
        if (path.endsWith('/owner')) return { id: 'owner', email }
        if (path.endsWith('/items/one')) return { id: 'one' }
        assert.fail('Unexpected call ' + path)
      },
    }
    await assert.rejects(recoveryPost(context, {
      action: 'restore', requestId: randomUUID(), sessionId, workload: 'Exchange',
      auth: { mode: 'deviceCode', userCode: 'test' }, items: [{ id: 'one', kind: 'item', ownerId: 'owner' }],
      options: { originalMailboxFolder: true, destination: 'alternate', mailbox: 'wrong@example.test', folder: 'Recovered' },
    }), error => error.status === 409)
    assert.deepEqual(writes, [])
  }
})
