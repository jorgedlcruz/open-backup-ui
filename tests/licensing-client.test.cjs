// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText.replace('"@/lib/utils/rate-limiter"', '"../utils/rate-limiter"'), file)
const { VeeamApiClient } = require('../lib/api/veeam-client.ts')

test('Licensing reuses server sessions on a direct visit, and keeps existing browser bearers product-specific', async t => {
  const calls = []
  t.mock.method(global,'fetch',async (path, init) => {
    calls.push([path,new Headers(init.headers).get('authorization'),init.credentials])
    if (path === '/api/vbm/auth') return Response.json({access_token:'m365-session',expires_in:3600})
    return Response.json({})
  })
  const client = new VeeamApiClient()
  await client.getLicensing('vbr')
  await client.getLicensing('vbm')
  assert.deepEqual(calls, [
    ['/api/vbr/licensing',null,'same-origin'],
    ['/api/vbm/licensing',null,'same-origin'],
  ])
  client.setToken('vbr-session')
  await client.getVBMLicense()
  calls.length = 0
  await client.getLicensing('vbr')
  await client.getLicensing('vbm')
  assert.deepEqual(calls, [
    ['/api/vbr/licensing','Bearer vbr-session','same-origin'],
    ['/api/vbm/licensing','Bearer m365-session','same-origin'],
  ])
})

test('A licensing rejection is reported without replaying reads or writes under another identity', async t => {
  const calls = []
  t.mock.method(global,'fetch',async (path, init) => {
    calls.push([path,init.method || 'GET',new Headers(init.headers).get('authorization')])
    return Response.json({error:'Permission denied'},{status:path.startsWith('/api/vbm/') ? 403 : 401})
  })
  const client = new VeeamApiClient()
  for (const platform of ['vbr','vbm']) await assert.rejects(client.getLicensing(platform), /Permission denied/)
  await assert.rejects(client.revokeLicenseSocket('socket'), /Permission denied/)
  await assert.rejects(client.revokeVB365License('user'), /Permission denied/)
  assert.deepEqual(calls, [
    ['/api/vbr/licensing','GET',null],['/api/vbm/licensing','GET',null],
    ['/api/veeam/license/sockets/socket/revoke','POST',null],['/api/vbm/LicensedUsers/user','DELETE',null],
  ])
})

test('License reports use cookie sessions once and reject a sign-in page in place of an attachment', async t => {
  const calls = []
  let landing = false
  t.mock.method(global,'fetch',async (path, init) => {
    calls.push([path,init.method,init.credentials,new Headers(init.headers).get('authorization'),init.redirect])
    if (landing) return new Response('<html>Sign in</html>',{headers:{'Content-Type':'text/html'}})
    const pdf = path.startsWith('/api/vbm/')
    return new Response(pdf ? '%PDF-1.7' : '<html>Report</html>',{headers:{
      'Content-Type':pdf ? 'application/pdf' : 'text/html; charset=utf-8',
      'Content-Disposition':'attachment; filename="report"',
    }})
  })
  const client = new VeeamApiClient()
  assert.equal(await client.createLicenseReport(),'<html>Report</html>')
  assert.equal(await (await client.generateVB365LicenseReport('from','to')).text(),'%PDF-1.7')
  landing = true
  await assert.rejects(client.createLicenseReport(),/did not return a license report/)
  assert.deepEqual(calls, [
    ['/api/veeam/license/createReport','POST','same-origin',null,'error'],
    ['/api/vbm/Reports/LicenseOverview','POST','same-origin',null,'error'],
    ['/api/veeam/license/createReport','POST','same-origin',null,'error'],
  ])
})
