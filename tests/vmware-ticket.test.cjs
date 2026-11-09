const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const https = require('node:https'), { execFileSync } = require('node:child_process')
const ts = require('typescript')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
}).outputText, file)
const { generateSelfSigned } = require('../lib/server/tls-runtime.cjs')
const { issueVmwareConsoleTicket, verifyVmwareConsoleConnection } = require('../lib/server/vmware-ticket.ts')
const { hasVmwareRestoreGrant } = require('../lib/activity/vmware-grant.ts')

test('console requires the Instant Recovery permission in the authenticated VBR access token', () => {
  const jwt = p => 'header.' + Buffer.from(JSON.stringify(p)).toString('base64url') + '.signature'
  assert.equal(hasVmwareRestoreGrant(jwt({permissions:['520','101']})), true)
  for (const token of [null,'opaque',jwt({permissions:'101'}),jwt({permissions:['11','10','1011']})]) {
    assert.equal(hasVmwareRestoreGrant(token), false)
  }
})

test('VMware checks TLS and the exact powered-on registration before issuing a single VM ticket, then closes its login', async t => {
  const openssl = [process.env.OPENSSL_BIN,'openssl','C:/Program Files/Git/usr/bin/openssl.exe'].filter(Boolean)
    .find(file => { try { execFileSync(file,['version'],{stdio:'ignore',windowsHide:true});return true } catch {return false} })
  if (!openssl) return t.skip('OpenSSL needed to create fixture certificates')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'open-backup-vmware-'))
  const {bundle} = generateSelfSigned(dir, {openssl, names:'127.0.0.1'})
  const calls = []
  let power = 'poweredOn', name = 'Recovered &amp; tested', vmId = '23', provider = 'HostAgent', badUrl = false
  const server = https.createServer({key:bundle.privateKeyPem, cert:bundle.certificatePem}, (req,res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const op = /<s:Body><(\w+)/.exec(body)?.[1]
      calls.push(op)
      assert.equal(req.url,'/sdk')
      if (op !== 'RetrieveServiceContent') assert.equal(req.headers.cookie,'vmware_soap_session="test-session"')
      let reply = ''
      if (op === 'RetrieveServiceContent') {
        res.setHeader('set-cookie','vmware_soap_session="test-session"; Path=/sdk; HttpOnly')
        reply = '<returnval><sessionManager>s1</sessionManager><propertyCollector>p1</propertyCollector><about><apiType>' + provider + '</apiType></about></returnval>'
      } else if (op === 'Login') {
        assert.ok(body.includes('<password>test&lt;&amp;&gt;</password>'))
        reply = '<returnval><key>test-session</key></returnval>'
      } else if (op === 'RetrievePropertiesEx') {
        assert.ok(body.includes('<obj type="VirtualMachine">' + vmId + '</obj>'))
        reply = '<returnval><objects><obj type="VirtualMachine">' + vmId + '</obj><propSet><name>name</name><val>' + name +
          '</val></propSet><propSet><name>runtime.powerState</name><val>' + power + '</val></propSet></objects></returnval>'
      } else if (op === 'AcquireTicket') {
        assert.ok(body.includes('<ticketType>webmks</ticketType>'))
        reply = '<returnval><ticket>single-use</ticket>' + (badUrl ? '<url>http://untrusted.invalid</url>' : '<host>console.test</host><port>443</port>') + '</returnval>'
      } else { assert.equal(op,'Logout') }
      res.end('<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body><' + op + 'Response xmlns="urn:vim25">' +
        reply + '</' + op + 'Response></env:Body></env:Envelope>')
    })
  })
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    fs.rmSync(dir,{recursive:true,force:true})
  })
  const cfg = {hostname:'127.0.0.1',port:server.address().port,username:'console',password:'test<&>',caPem:bundle.certificatePem}
  const target = {server:cfg.hostname,port:cfg.port,provider:'esxi',vmId,vmName:'Recovered & tested',powerState:'PoweredOn'}
  await assert.rejects(verifyVmwareConsoleConnection({...cfg,caPem:undefined}), /trusted HTTPS/)
  assert.deepEqual(calls,[])
  await verifyVmwareConsoleConnection(cfg)
  assert.deepEqual(calls.splice(0),['RetrieveServiceContent','Login','Logout'])
  assert.deepEqual(await issueVmwareConsoleTicket(cfg,target),{name:target.vmName,url:'wss://console.test/ticket/single-use'})
  assert.deepEqual(calls.splice(0),['RetrieveServiceContent','Login','RetrievePropertiesEx','AcquireTicket','Logout'])
  power = 'poweredOff'
  await assert.rejects(issueVmwareConsoleTicket(cfg,target), {status:409})
  assert.deepEqual(calls.splice(0),['RetrieveServiceContent','Login','RetrievePropertiesEx','Logout'])
  power = 'poweredOn'; name = 'Production'
  await assert.rejects(issueVmwareConsoleTicket(cfg,target), {status:409})
  assert.ok(!calls.includes('AcquireTicket')); calls.length = 0
  vmId = 'vm-888'; provider = 'VirtualCenter'; name = 'Recovered &amp; tested'; badUrl = true
  await assert.rejects(issueVmwareConsoleTicket(cfg,{...target,provider:'vcenter',vmId}), /unexpected console response/)
  assert.equal(calls.at(-1),'Logout')
})
