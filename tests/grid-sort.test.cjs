/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText, filename)
const {test}=require('node:test'),assert=require('node:assert/strict')
const {sortGridRows,dateSortValue,sortKind}=require('../lib/grid-sort.ts')
const columns=[{id:'date',kind:'date',value:r=>r.date},{id:'name',value:r=>r.name},{id:'size',kind:'number',value:r=>r.size}]
const order=(id,direction='desc')=>({id,direction,label:id})
test('dates use instants, not formatted labels or timezone text',()=>{
 const rows=[{date:'2026-10-25T11:00:00+02:00',id:1},{date:'2026-10-25T10:00:00Z',id:2},{date:'2025-12-31T23:59:59Z',id:3}]
 assert.deepEqual(sortGridRows(rows,columns,order('date')).map(r=>r.id),[2,1,3])
 assert.deepEqual(sortGridRows(rows,columns,order('date','asc')).map(r=>r.id),[3,1,2])
})
test('invalid and missing dates stay last in both directions and retain their relative order',()=>{
 const rows=[{id:1,date:null},{id:2,date:'2026-02-30T10:00:00Z'},{id:3,date:'2026-01-02'},{id:4,date:'Not reported'},{id:5,date:'2026-01-01'}]
 assert.deepEqual(sortGridRows(rows,columns,order('date')).map(r=>r.id),[3,5,1,2,4])
 assert.deepEqual(sortGridRows(rows,columns,order('date','asc')).map(r=>r.id),[5,3,1,2,4])
})
test('date parsing accepts leap days, numeric timestamps and Date values without accepting impossible calendar dates',()=>{
 assert.equal(dateSortValue('2024-02-29'),Date.parse('2024-02-29'))
 for(const value of ['2026-02-29','2026-13-01','2026-01-00','2026-01-01T25:00:00Z','Unknown',NaN,new Date(NaN)])assert.equal(dateSortValue(value),null)
 assert.equal(dateSortValue(0),0);assert.equal(dateSortValue(new Date(0)),0)
})
test('numeric sorting compares raw bytes and preserves meaningful zero',()=>{
 const rows=[{size:null},{size:0},{size:1024},{size:12},{size:Infinity}]
 assert.deepEqual(sortGridRows(rows,columns,order('size')).map(r=>r.size),[1024,12,0,null,Infinity])
 assert.deepEqual(sortGridRows(rows,columns,order('size','asc')).map(r=>r.size),[0,12,1024,null,Infinity])
})
test('names sort naturally, ignoring case, and duplicate values remain stable',()=>{
 const rows=[{name:'VM10',id:1},{name:'vm2',id:2},{name:'VM2',id:3},{name:'vm1',id:4}]
 assert.deepEqual(sortGridRows(rows,columns,order('name','asc')).map(r=>r.id),[4,2,3,1])
})
test('sort does not mutate data and reset restores the caller default order',()=>{
 const rows=Object.freeze([{name:'B'},{name:'A'}]);sortGridRows(rows,columns,order('name','asc'))
 assert.deepEqual(rows.map(r=>r.name),['B','A']);assert.deepEqual(sortGridRows(rows,columns,null),rows)
 assert.deepEqual(sortGridRows(rows,columns,order('hidden')),rows)
})
test('sorting precedes pagination across the full loaded collection',()=>{
 const rows=Array.from({length:45},(_,i)=>({date:new Date(i*86400000).toISOString(),id:i}))
 const sorted=sortGridRows(rows,columns,order('date'))
 assert.deepEqual(sorted.slice(0,3).map(r=>r.id),[44,43,42])
 assert.deepEqual(sorted.slice(20,23).map(r=>r.id),[24,23,22])
})
test('SOBR groups stay together and all extents sort before pagination without duplication',()=>{
 const rows=[{g:'A',size:1},{g:'A',size:9},{g:'B',size:12},{g:'B',size:2}]
 const sorted=sortGridRows(rows,columns,order('size'),r=>r.g)
 assert.deepEqual(sorted.map(r=>[r.g,r.size]),[['A',9],['A',1],['B',12],['B',2]])
 assert.equal(new Set(sorted).size,4)
})
test('report cells infer raw numeric and date values including wrapped API values',()=>{
 const c={id:'value',value:r=>r.value}
 assert.equal(sortKind([{value:{value:12}},{value:{value:2}}],c),'number')
 assert.equal(sortKind([{value:'2026-10-25T09:00:00Z'},{value:null}],c),'date')
 assert.deepEqual(sortGridRows([{value:{value:12}},{value:{value:2}}],[c],order('value','asc')).map(r=>r.value.value),[2,12])
})
test('TanStack adapter sorts dates before pagination and keeps missing values last in both directions',()=>{
 const {createTable,getCoreRowModel,getSortedRowModel,getPaginationRowModel}=require('@tanstack/react-table')
 const {sortableColumns}=require('../lib/table-sort.ts')
 const data=[{lastRun:null,id:'missing'},{lastRun:'2026-02-30',id:'invalid'},...Array.from({length:30},(_,i)=>({lastRun:new Date(i*86400000).toISOString(),id:i}))]
 for(const desc of [true,false]){
  const sorting=[{id:'lastRun',desc}],table=createTable({data,columns:sortableColumns([{accessorKey:'lastRun',header:'Last run'}],sorting,data),state:{sorting,pagination:{pageIndex:0,pageSize:10}},getCoreRowModel:getCoreRowModel(),getSortedRowModel:getSortedRowModel(),getPaginationRowModel:getPaginationRowModel()})
  assert.deepEqual(table.getSortedRowModel().rows.slice(-2).map(r=>r.original.id),['missing','invalid'])
  assert.equal(table.getRowModel().rows[0].original.id,desc?29:0)
  assert.equal(table.getRowModel().rows.length,10)
 }
})
test('TanStack adapter keeps accessor display values, action columns and numeric zero intact',()=>{
 const {createTable,getCoreRowModel,getSortedRowModel}=require('@tanstack/react-table'),{sortableColumns}=require('../lib/table-sort.ts')
 const data=[{bytes:0},{bytes:null},{bytes:24}],sorting=[{id:'bytes',desc:true}],actions={id:'actions',header:'Actions',enableSorting:false}
 const mapped=sortableColumns([{accessorKey:'bytes'},actions],sorting,data)
 assert.equal(mapped[1],actions)
 const table=createTable({data,columns:mapped,state:{sorting},getCoreRowModel:getCoreRowModel(),getSortedRowModel:getSortedRowModel()})
 assert.deepEqual(table.getRowModel().rows.map(r=>r.getValue('bytes')),[24,0,null])
})
