// Open Backup UI v1.0.2
/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const Module=require('node:module')
const ts=require('typescript')
const root=path.resolve(__dirname,'..')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename)
const {translate}=require('../lib/i18n/model.ts')
const {m365Label}=require('../lib/i18n/m365.ts')
const messages=JSON.parse(fs.readFileSync(path.join(root,'lib/i18n/messages/es.json'),'utf8'))
const t=(source,values)=>translate(messages,source,values)
const filename=path.join(root,'components/vbm-dashboard/presentation.ts')
const compiled=new Module(filename,module)
compiled.filename=filename;compiled.paths=module.paths
compiled.require=function(spec){
  if(spec==='@/components/providers/i18n-provider')return {useI18n:()=>({t,locale:'es',formatNumber:(v,o)=>new Intl.NumberFormat('es',o).format(v),formatDate:(v,o)=>new Intl.DateTimeFormat('es',o).format(new Date(v))})}
  if(spec==='@/lib/i18n/m365')return {m365Label}
  if(spec==='@/lib/restore-points/model')return require('../lib/restore-points/model.ts')
  return module.require(spec)
}
compiled._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename)
const presentation=compiled.exports.useDashboardPresentation()
test('Microsoft 365 shared display helpers use the chosen locale and preserve missing evidence',()=>{
  assert.equal(presentation.number(12345.5),new Intl.NumberFormat('es').format(12345.5))
  assert.equal(presentation.number(null),t('Unknown'))
  assert.equal(presentation.bytes(1536),'1,5 KiB')
  assert.equal(presentation.bytes(null),t('Unknown'))
  assert.equal(presentation.bytes(0.5),t('Unknown'))
  assert.equal(presentation.date('invalid'),t('Not reported'))
  assert.equal(presentation.date('2026-10-27T12:30:00Z'),new Intl.DateTimeFormat('es',{dateStyle:'medium',timeStyle:'short'}).format(new Date('2026-10-27T12:30:00Z')))
})
test('display names are preserved even when they equal an English fallback or catalog key',()=>{
  const snapshot={organizations:{data:[{id:'org',name:'Organization not reported'}]},repositories:{data:[{id:'repo',name:'Repository not reported'}]}}
  assert.equal(presentation.orgName(snapshot,'org'),'Organization not reported')
  assert.equal(presentation.repoName(snapshot,'repo'),'Repository not reported')
  assert.equal(presentation.value('Not reported'),'Not reported')
  assert.equal(presentation.value(null),t('Not reported'))
  assert.equal(presentation.orgName(snapshot,null),t('Organization not reported'))
  assert.equal(presentation.repoName(snapshot,'opaque-id'),'opaque-id')
  assert.equal(presentation.label('VendorState-Z42'),'VendorState-Z42')
})
test('Microsoft 365 dashboard investigation dialog has no raw static UI strings',()=>{
  const audit=require('../scripts/audit-i18n.cjs').auditProject(root)
  assert.deepEqual(audit.findings.filter(item=>item.path==='components/vbm-dashboard/investigation-dialog.tsx'),[])
  assert.ok(audit.registrations.some(item=>item.path==='components/vbm-dashboard/investigation-dialog.tsx'&&item.key==='Configured quota (API GB)'))
})
