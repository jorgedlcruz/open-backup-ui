const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText.replace('"@/lib/utils/rate-limiter"', '"../utils/rate-limiter"'), file)
const {VeeamApiClient} = require('../lib/api/veeam-client.ts')
test('Activity uses the current connection and can open a restore session with a browser bearer', async t => {
  const calls = []
  let cookieSession = true
  t.mock.method(global,'fetch',async (path, init) => {
    const bearer = new Headers(init.headers).get('authorization')
    calls.push([new URL(path,'http://app.local').pathname,bearer])
    if (String(path).endsWith('/api/veeam/auth')) return Response.json({access_token:'test-token',expires_in:3600})
    return cookieSession || bearer === 'Bearer test-token' ? Response.json({id:1}) : Response.json({error:'Reconnect'}, {status:401})
  })
  const client = new VeeamApiClient(), path = '/api/vbr/activity/sessions/test'
  await client.requestActivity(path)
  assert.deepEqual(calls,[[path,null]])
  calls.length = 0; cookieSession = false
  await client.requestActivity(path)
  await client.requestActivity(path,{method:'POST'})
  assert.deepEqual(calls,[[path,null],['/api/veeam/auth',null],[path,'Bearer test-token'],[path,'Bearer test-token']])
  calls.length = 0
  await assert.rejects(new VeeamApiClient().requestActivity(path,{method:'POST'}))
  assert.deepEqual(calls,[[path,null]]) // A command is never retried after failure.
})
