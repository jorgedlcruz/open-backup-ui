/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test'),{createHash}=require('node:crypto')
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText
require.extensions['.ts']=(module,file)=>module._compile(compile(file),file)
const m=require('../lib/one-alarms/model.ts'),l=require('../lib/one-alarms/load.ts')
const now=Date.parse('2026-10-24T20:00:00Z'),key='a'.repeat(64),plain=value=>JSON.parse(JSON.stringify(value))
const raw=patch=>({time:'2026-10-24T18:00:00Z',status:'Error',triggeredAlarmId:90,triggeredSubAlarmId:12,alarmId:214,entityId:3,entityType:'VbrBackupServer',entityName:'Server',isVid:false,description:'Job failed<br>Disk full',alarmName:'Job state',source:'Job A',...patch})
const alarm=patch=>m.normalizeAlarm(raw(patch)),input=patch=>({sourceKey:key,parentId:90,childId:12,expectedRevision:l.revision(alarm()),comment:'Reviewed issue',...patch})
const reply=(status,data)=>({ok:status>=200 && status<300,status,json:async()=>data})
test('unknown flags, unsafe IDs, future statuses and zero coordinates remain explicit',()=>{
 const row=alarm({status:'FutureState',entityId:Number.MAX_SAFE_INTEGER+2,isVid:undefined,latitude:0,longitude:0,password:'secret'})
 assert.equal(row.entityId,null);assert.equal(row.isVid,null);assert.equal(row.status,'FutureState');assert.equal(m.hasCoordinates(row),true);assert.doesNotMatch(JSON.stringify(row),/password|secret/)
 assert.equal(m.hasCoordinates(alarm({latitude:91,longitude:10})),false);assert.equal(m.hasCoordinates(alarm()),false)
})
test('child records sharing one parent remain distinct for navigation',()=>{
 assert.notEqual(alarm().key,alarm({triggeredSubAlarmId:13}).key)
 assert.notEqual(alarm().key,alarm({status:'Resolved'}).key)
})
test('objects with equal names are grouped only by stable identity, not display text',()=>{
 const groups=m.affectedObjects([alarm(),alarm({triggeredSubAlarmId:13}),alarm({entityId:4}),alarm({entityId:null}),alarm({entityId:null,triggeredSubAlarmId:14}),alarm({isVid:true})])
 assert.equal(groups.length,5);assert.equal(groups[0].alarms.length,2);assert.equal(groups.filter(row=>!row.known).length,2)
})
test('composed severity, issue, location, object and description filters retain OR semantics',()=>{
 const row=alarm({time:'2026-10-22T18:00:00Z',region:'Europe',cityName:'London'})
 assert.equal(m.matchAlarm(row,{...m.emptyFilters,statuses:['Warning','Error'],issue:'aged',query:'disk full',entity:m.entityKey(row),location:m.locationKey(row),type:'VbrBackupServer'},now),true)
 assert.equal(m.matchAlarm(row,{...m.emptyFilters,statuses:['Warning']},now),false)
 assert.equal(m.matchAlarm(alarm({time:''}),{...m.emptyFilters,issue:'aged'},now),false)
 assert.equal(m.matchAlarm(alarm({status:'Future'}),{...m.emptyFilters,issue:'unknown'},now),true)
})
test('timezone-less API times are UTC and selected end days are inclusive',()=>{
 assert.equal(alarm({time:'2026-10-24T00:00:00'}).time,'2026-10-24T00:00:00.000Z')
 assert.equal(m.matchAlarm(alarm({time:'2026-10-24T23:59:59Z'}),{...m.emptyFilters,from:'2026-10-24',to:'2026-10-24'},now),true)
 assert.equal(m.matchAlarm(alarm({time:'2026-10-25T00:00:00Z'}),{...m.emptyFilters,from:'2026-10-24',to:'2026-10-24'},now),false)
})
test('native history bins preserve totals and every reported status',()=>{
 const days=Array.from({length:150},(_,i)=>({time:new Date(now-i*86400000).toISOString(),status:i%2 ? 'Resolved':'Acknowledged',count:i+1}))
 const bins=m.historyBins(days,60);assert.ok(bins.length<=60);assert.equal(bins.reduce((n,row)=>n+row.total,0),11325)
 assert.ok(bins.some(row=>row.counts.Resolved));assert.ok(bins.some(row=>row.counts.Acknowledged))
 assert.equal(l.normalizeDay({time:'2026-10-24T00:00:00',status:'Warning',status_Count:3}).time,'2026-10-24T00:00:00.000Z')
 assert.throws(()=>l.normalizeDay({time:'bad',status_Count:3}));assert.throws(()=>l.normalizeDay({time:'2026-10-24',status_Count:null}))
})
test('description and knowledge text retain line breaks, entities and safe link destinations',()=>{
 assert.equal(m.plainText('<p>Disk &lt; 10%</p><br/><b>Failed</b><script>private()</script><a href="https://example.test/kb">Read</a>'),'Disk < 10%\n\nFailedRead (https://example.test/kb)')
 assert.doesNotMatch(m.plainText('<img src=x onerror=run()>Safe'),/onerror/)
 assert.equal(m.plainText('Failed <workload-name> &lt;disk&gt;'),'Failed <workload-name> <disk>')
})
test('history filters never send the unsupported Remediated enum and preserve discovery origin',()=>{
 for(const patch of [{issue:'resolved'},{issue:'unknown'},{statuses:['Remediated']},{statuses:['Remediated','Error']}])assert.doesNotMatch(l.apiFilter({...m.emptyFilters,...patch},now),/Remediated/)
 const filter=JSON.parse(l.apiFilter({...m.emptyFilters,range:'all',entity:JSON.stringify([3,'VbrBackupServer',false])},now));assert.ok(filter.items.some(row=>row.property==='isVid' && row.value===false))
})
test('read-only POST queries fall back only on 404/405, retaining the GET query contract',async()=>{
 const calls=[];await l.query(async(path,method,body)=>{calls.push({path,method,body});if(method)throw new l.AlarmError('old build',405);return {items:[]}},'triggeredChildAlarms',{offset:20,limit:20,filter:'filter'})
 assert.equal(calls[0].method,'POST');assert.deepEqual(calls[0].body,{onlyVid:false,query:{offset:20,limit:20,filter:'filter'}});assert.match(calls[1].path,/Offset=20&Limit=20&Filter=filter/)
 let requests=0;await assert.rejects(l.query(async()=>{requests++;throw new l.AlarmError('forbidden',403)},'triggeredChildAlarms',{offset:0,limit:20}));assert.equal(requests,1)
})
test('inventory pagination reads beyond the legacy 200 cap',async()=>{
 const offsets=[],result=await l.collection(async(offset,limit)=>{offsets.push(offset);return {items:Array.from({length:Math.min(limit,450-offset)},(_,i)=>raw({triggeredSubAlarmId:offset+i+1})),totalCount:450}},m.normalizeAlarm,row=>row.key,'Alarms')
 assert.deepEqual(offsets,[0,200,400]);assert.equal(result.data.length,450);assert.equal(result.complete,true)
})
test('repeated, failed, truncated and malformed reads stay partial without losing prior pages',async()=>{
 const first=Array.from({length:200},(_,i)=>raw({triggeredSubAlarmId:i+1}))
 const repeated=await l.collection(async()=>({items:first,totalCount:450}),m.normalizeAlarm,row=>row.key,'Alarms');assert.equal(repeated.complete,false);assert.equal(repeated.data.length,200)
 const failed=await l.collection(async offset=>{if(offset)throw Error('private error');return {items:first,totalCount:450}},m.normalizeAlarm,row=>row.key,'Alarms');assert.equal(failed.data.length,200);assert.doesNotMatch(failed.error,/private error/)
 const limited=await l.collection(async()=>({items:first,totalCount:450}),m.normalizeAlarm,row=>row.key,'Alarms',200);assert.equal(limited.complete,false)
 const invalid=await l.collection(async()=>({items:null}),m.normalizeAlarm,row=>row.key,'Alarms');assert.equal(invalid.complete,false);assert.equal(invalid.data.length,0)
})
test('authentication or source changes invalidate the entire read',async()=>{
 for(const status of [401,409])await assert.rejects(l.collection(async()=>{throw new l.AlarmError('changed',status)},m.normalizeAlarm,row=>row.key,'Alarms'),e=>e.status===status)
})
test('overview aggregates all history statuses without sorting raw timestamps into daily groups',async()=>{
 const calls=[],snapshot=await l.loadOverview(async(path,method,body)=>{calls.push({path,method,body});return body.query.groupBy ? {items:[{time:'2026-10-24',status:'Resolved',status_Count:20}],totalCount:1}:{items:[raw()],totalCount:1}},m.emptyFilters,0,'ONE',key,now)
 assert.equal(snapshot.days.data[0].count,20);assert.equal(snapshot.current.data[0].revision,l.revision(alarm()));const group=calls.find(call=>call.body.query.groupBy);assert.equal(group.body.query.sort,undefined);assert.match(group.body.query.groupBy,/Day/)
})
test('history is paged independently and trigger detail uses both IDs',async()=>{
 const calls=[],execute=async(path,method,body)=>{calls.push({path,method,body});return path.includes('/templates/') ? {alarmTemplateId:214,name:'State',knowledgeCause:'Cause'}:{items:[raw()],totalCount:1}}
 await l.historyPage(execute,'filter',3);assert.equal(calls[0].body.query.offset,60)
 const detail=await l.loadDetail(execute,214,90,12,key);const query=calls.at(-1).body.query;assert.match(query.filter,/triggeredAlarmId/);assert.match(query.filter,/triggeredSubAlarmId/);assert.equal(detail.template.data.cause,'Cause')
})
test('resolution uses the child endpoint and exact documented payload after fresh revision check',async()=>{
 const calls=[];await l.resolveAlarm(async(path,method,body,mutation)=>{calls.push({path,method,body,mutation});return {items:[raw()],totalCount:1}},input())
 assert.equal(calls.length,2);assert.match(calls[1].path,/triggeredChildAlarms\/resolve$/);assert.equal(calls[1].mutation,true);assert.deepEqual(calls[1].body,{triggeredChildAlarmIds:[12],comment:'Reviewed issue',resolveType:'Resolve'})
})
test('changed, ambiguous, closed and wrong-child evidence prevents alarm resolution',async()=>{
 for(const items of [[],[raw(),raw()],[raw({status:'Resolved'})],[raw({description:'Changed'})],[raw({triggeredSubAlarmId:13})]]) {
 let writes=0;await assert.rejects(l.resolveAlarm(async(_path,_method,_body,mutation)=>{if(mutation)writes++;return {items}},input()),e=>e.status===409);assert.equal(writes,0)
 }
 for(const patch of [{comment:''},{comment:'x'.repeat(1025)},{childId:Number.MAX_SAFE_INTEGER+1},{unknown:true}])assert.equal(l.resolveSchema.safeParse(input(patch)).success,false)
})

function harness(options={}) {
 let source={id:'one-source',platform:'one',protocol:'https',host:'one.test',port:1239,username:'operator',password:'private-password'},auths=0
 const calls=[],cookies={veeam_one_source_id:'one-source',...options.cookies},exports={}
 class Response {static json(body,init={}){return {body,status:init.status||200,headers:init.headers}}}
 const deps={'node:crypto':require('node:crypto'),'next/server':{NextResponse:Response},'next/headers':{cookies:async()=>({get:name=>cookies[name] ? {value:cookies[name]}:undefined})},'./config-store':{configStore:{getById:id=>source && id===source.id ? source:null}},'./token-manager':{tokenManager:{peek:()=>options.noToken ? null:{accessToken:'bound-token',expiresAt:Date.now()/1000+3600},remember:()=>{auths++}}},'../utils/cookie-manager':{getChunkedCookie:(_jar,name)=>cookies[name]},'../one-alarms/load':l,'../one-alarms/model':m}
 const mock=async(url,init)=>url.pathname==='/api/token' ? reply(200,{access_token:'fresh-token',expires_in:300}):url.pathname.endsWith('/resolve') ? reply(200,{private:'mutation metadata'}):JSON.parse(init.body||'{}').query?.groupBy ? reply(200,{items:[{time:'2026-10-24',status:'Error',status_Count:1}],totalCount:1}):reply(200,{items:[raw()],totalCount:1})
 vm.runInNewContext(compile(require.resolve('../lib/server/one-alarms.ts')),{exports,require:name=>{if(!(name in deps))throw Error(name);return deps[name]},URL,URLSearchParams,Date,AbortController,setTimeout,clearTimeout,fetch:async(url,init)=>{calls.push({url:String(url),...init});return options.fetch ? options.fetch(url,init,mock):mock(url,init)}})
 const sourceKey=createHash('sha256').update(JSON.stringify(['one-source','https://one.test:1239','operator'])).digest('hex')
 const request=(body={},headers={},query='')=>({nextUrl:new URL('http://localhost:3000/api/one/alarms'+query),signal:new AbortController().signal,headers:new Headers({origin:'http://localhost:3000',...headers}),json:async()=>({...body})})
 return {exports,calls,request,sourceKey,auths:()=>auths,change:patch=>{source=patch===null ? null:{...source,...patch}}}
}
test('selected-source queries use only bound credentials and return no token or password',async()=>{
 const h=harness({cookies:{veeam_one_token:'foreign-token'}}),result=await h.exports.readAlarms(h.request())
 assert.equal(result.status,200);assert.equal(result.headers['Cache-Control'],'private, no-store');assert.doesNotMatch(JSON.stringify(result),/bound-token|foreign-token|private-password/)
 for(const call of h.calls){assert.match(call.url,/^https:\/\/one.test:1239\//);assert.equal(call.headers.Authorization,'Bearer bound-token');assert.equal(call.redirect,'error');assert.equal(call.cache,'no-store')}
})
test('foreign cookies cannot authenticate a different configured endpoint',async()=>{
 const h=harness({noToken:true,cookies:{veeam_one_token:'foreign-token',veeam_one_token_url:'https://other.test:1239'}});h.change({password:undefined})
 assert.equal((await h.exports.readAlarms(h.request())).status,401);assert.equal(h.calls.length,0)
})
test('cross-origin, stale-source and invalid resolution requests stop before any network calls',async()=>{
 const h=harness();assert.equal((await h.exports.mutateAlarms(h.request(input(),{origin:'https://foreign.test'}))).status,403)
 assert.equal((await h.exports.mutateAlarms(h.request(input()))).status,409);assert.equal((await h.exports.mutateAlarms(h.request({}))).status,400);assert.equal(h.calls.length,0)
})
test('invalid calendar dates, inverted dates and malformed object identities fail before fetching',async()=>{
 for(const patch of [{from:'2026-02-30'},{from:'2026-10-25',to:'2026-10-24'},{entity:'not-json'}]){const h=harness();assert.equal((await h.exports.readAlarms(h.request({}, {},`?filters=${encodeURIComponent(JSON.stringify(patch))}`))).status,400);assert.equal(h.calls.length,0)}
})
test('configuration changes during preflight or authentication stop subsequent sends',async()=>{
 let h;h=harness({fetch:async(url,init,mock)=>{const response=await mock(url,init);h.change({host:'changed.test'});return response}})
 assert.equal((await h.exports.mutateAlarms(h.request(input({sourceKey:h.sourceKey})))).status,409);assert.equal(h.calls.length,1)
 let a;a=harness({noToken:true,fetch:async(url,init,mock)=>{const response=await mock(url,init);a.change({username:'different'});return response}})
 assert.equal((await a.exports.readAlarms(a.request())).status,409);assert.equal(a.calls.length,1);assert.equal(a.auths(),0)
})
test('401 on read-only POST queries refreshes once; concurrent reads share authentication',async()=>{
 const h=harness({fetch:async(url,init,mock)=>init.headers.Authorization==='Bearer bound-token' ? reply(401,{}):mock(url,init)})
 assert.equal((await h.exports.readAlarms(h.request())).status,200);assert.equal(h.auths(),1);assert.equal(h.calls.filter(call=>call.url.endsWith('/api/token')).length,1)
})
test('alarm resolutions are never replayed after rejection or uncertain transport outcomes',async()=>{
 for(const fail of [()=>reply(401,{}),()=>{throw Error('private transport trace')}]) {
 const h=harness({fetch:async(url,init,mock)=>url.pathname.endsWith('/resolve') ? fail():mock(url,init)}),result=await h.exports.mutateAlarms(h.request(input({sourceKey:h.sourceKey})))
 assert.match(result.body.error,/outcome could not be confirmed/);assert.doesNotMatch(result.body.error,/private/);assert.equal(h.calls.filter(call=>call.url.endsWith('/resolve')).length,1);assert.equal(h.auths(),0)
 }
})
test('accepted resolution does not expose raw upstream mutation metadata',async()=>{
 const h=harness(),result=await h.exports.mutateAlarms(h.request(input({sourceKey:h.sourceKey})));assert.deepEqual(plain(result.body),{accepted:true});assert.doesNotMatch(JSON.stringify(result),/mutation metadata/)
})
test('the replacement page and visualization components do not import legacy chart libraries',()=>{
 for(const file of ['app/(app)/analytics/alarms/page.tsx',...fs.readdirSync('components/one-alarms').filter(name=>name.endsWith('.tsx')).map(name=>'components/one-alarms/'+name)])assert.doesNotMatch(fs.readFileSync(file,'utf8'),/from ["'](?:recharts|@tremor|react-simple-maps|d3-|@\/components\/analytics\/alarms)/)
})
