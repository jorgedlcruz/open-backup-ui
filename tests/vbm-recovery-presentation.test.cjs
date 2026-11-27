// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(loaded,filename)=>loaded._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename)
const {test}=require('node:test'),assert=require('node:assert/strict')
const {recoveryFilters,recoveryCategory,recoverySummary}=require('../lib/vbm-recovery/presentation.ts')
const session=(id,overrides={})=>({id,name:'Backup explorer',workload:'Exchange',type:'Vex',state:'Working',...overrides})

test('M365 working sessions stay in progress without claiming explorer readiness or completion',()=>{
  for(const row of [session('external'),session('browse',{context:{workload:'Exchange'}}),session('child',{context:{workload:'Exchange'},parentSessionId:'browse'}),session('working-success',{result:'Success'}),session('working-warning',{result:'Warning'})]) {
    assert.equal(recoveryCategory(row),'active')
  }
  assert.deepEqual(recoveryFilters,['all','active','attention','completed'])
})

test('M365 completion requires a stopped successful session; incomplete or unknown outcomes need attention',()=>{
  assert.equal(recoveryCategory(session('success',{state:'Stopped',result:'Success'})),'completed')
  for(const result of ['Warning','Failed',undefined,'Unknown'])assert.equal(recoveryCategory(session('stopped',{state:'Stopped',result})),'attention')
  for(const state of ['Unknown','', 'FutureState'])assert.equal(recoveryCategory(session('unknown',{state,result:'Success'})),'attention')
})

test('recovery summary counts only loaded unique sessions and reconciles an overlapping updated row',()=>{
  const rows=[session('a'),session('b',{state:'Stopped',result:'Failed'}),session('c',{state:'Stopped',result:'Success'}),session('a',{state:'Stopped',result:'Success'})]
  const counts=recoverySummary(rows)
  assert.deepEqual(counts,{all:3,active:0,attention:1,completed:2})
  assert.equal(counts.active+counts.attention+counts.completed,counts.all)
  assert.equal(rows.length,4)
  assert.deepEqual(recoverySummary([]),{all:0,active:0,attention:0,completed:0})
})
