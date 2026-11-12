// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs')
const ts=require('typescript')
const {test}=require('node:test')
const assert=require('node:assert/strict')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename)
const {m365Label,m365Diagnostic}=require('../lib/i18n/m365.ts')
const {translate}=require('../lib/i18n/model.ts')
const render=(source,values)=>`translated:${translate({},source,values)}`

test('Microsoft 365 evidence labels translate known enums and anchored summaries without touching unknown values',()=>{
  assert.equal(m365Label(render,'SelectedItems'),'translated:Selected items')
  assert.equal(m365Label(render,'EntireOrganization'),'translated:Entire organization')
  assert.equal(m365Label(render,'Unavailable to an organization'),'translated:Unavailable to organization')
  assert.equal(m365Label(render,'Disk: low space'),'translated:translated:Disk: translated:Low space')
  assert.equal(m365Label(render,'Disk: low space (87.5%)','es'),'translated:translated:Disk: translated:Low space (87,5 %)')
  assert.equal(m365Label(render,'Older than 12345h','es'),'translated:Older than 12.345 hours')
  assert.equal(m365Label(render,'Server 8.2.0.123 · check compatibility'),'translated:Server 8.2.0.123 · check compatibility')
  assert.equal(m365Label(render,'Out of order: Vendor text {scope} $&'),'translated:Out of order: Vendor text {scope} $&')
  for(const source of ['VendorState-Y7','Exchange','OneDrive','SharePoint','Teams','prefix Disk: low space suffix','Success backup on unknown source'])assert.equal(m365Label(render,source),source)
})

test('known collector diagnostics localize envelopes, counts and app errors while preserving names and provider details',()=>{
  const name='srv-Unknown-{section}-$&',vendor='Vendor error 812: SelectedItems {state} $&'
  const text=`Storage for ${name}: partial collection. ${vendor}`
  assert.equal(m365Diagnostic(render,text,'es'),`translated:translated:Storage for ${name}: translated:Partial collection. ${vendor}`)
  assert.equal(m365Diagnostic(render,'Session log: partial. Only loaded entries are shown.'),'translated:Session log: translated:Partial. translated:Only loaded entries are shown.')
  assert.equal(m365Diagnostic(render,'Collection limited to 12345 records.','es'),'translated:Collection limited to 12.345 records.')
  assert.equal(m365Diagnostic(render,'The Microsoft 365 source rejected the action (HTTP 403). Check permissions, credentials and proxy availability.'),'translated:The Microsoft 365 source rejected the action (HTTP 403). Check permissions, credentials and proxy availability.')
  assert.equal(m365Diagnostic(render,vendor),vendor)
  assert.equal(m365Diagnostic(render,'prefix These records could not be read. suffix'),'prefix These records could not be read. suffix')
})

test('Microsoft 365 detail pages and shared presentation have no unwrapped static UI copy',()=>{
  const audit=require('../scripts/audit-i18n.cjs').auditProject()
  const files=new Set(['components/vbm-jobs/job-investigation.tsx','components/vbm-jobs/session-investigation.tsx','components/vbm-jobs/session-table.tsx','components/vbm-organizations/organization-investigation.tsx','components/vbm-organizations/shared.tsx','components/vbm-repositories/repository-investigation.tsx','components/vbm-repositories/shared.tsx','components/vbm-proxies/proxy-investigation.tsx','components/vbm-proxies/shared.tsx','components/vbm-protected/restore-points.tsx','components/vbm-protected/calendar.tsx','components/vbm-protected/shared.tsx'])
  assert.deepEqual(audit.findings.filter(row=>files.has(row.path)),[])
  const session=fs.readFileSync('components/vbm-jobs/session-investigation.tsx','utf8')
  assert.match(session,/<option key=\{type\} value=\{type\}>\{localLabel\(type\)\}/)
  const points=fs.readFileSync('components/vbm-protected/restore-points.tsx','utf8')
  assert.match(points,/<option key=\{state\} value=\{state\}>\{localLabel\(state\)\}/)
  assert.match(session,/\{row\.message \|\| t\("No message reported"\)\}/)
})
