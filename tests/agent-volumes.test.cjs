// Open Backup UI v1.2.0
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test')
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f)
const {agentVolumes,volumeCommand}=require('../lib/recovery/agent-volumes.ts')
const id=n=>'12344567-1111-4111-8111-'+String(n).padStart(12,'0'),sourceKey='a'.repeat(64),principal='b'.repeat(64)
const backupId=id(1),objectId=id(2),restorePointId=id(3),targetId=id(4),sessionId=id(5),layoutId=id(6),mediaId=id(7),childBackupId=id(8)
const scope={sourceKey,backupId,objectId,restorePointId},pager=data=>({data,pagination:{skip:0,total:data.length}})
function fixture(){
  const point={id:restorePointId,backupId,platformName:'WindowsPhysical',name:'PC',creationTime:'2026-01-01T12:00:00Z',allowedOperations:['StartFlrRestore']}
  const object={id:objectId,backupId,platformName:'WindowsPhysical',type:'Computer',name:'PC'}
  const grants=['CreateRecoveryToken','CreateRecoveryMedia'].map(operation=>({enabled:true,operation}))
  const parts={disks:[{number:0,size:{size:32,unit:'Gb'},partitions:[{name:'C:',liveVolumeId:id(9)}]}],version:1}
  const appliance={id:targetId,isVerified:true,isDetached:false,platformType:'WindowsPhysical',hostName:'Machine A'}
  const row={...object,id:restorePointId,objectId,childBackupId,itemIconType:'WindowsAgentMachine',operations:grants}
  const rights=['ViewBackupObjects','ViewRestorePoints','PerformVolumeRestore','DiskManagement','ViewAgentsRecoveryAppliances','CreateComputerRecoveryToken','ViewBackups','PerformRemoteBareMetalRecovery']
  const data={point,objects:[object],rows:[row],targets:[appliance],rights,writes:[],checks:[],reject:'',taskType:'RecoveryMedia',
    layout:{id:targetId,diskManagementSessionId:layoutId,targetLayout:parts,sourceLayout:parts,volumeMatchingResults:parts}}
  const priv=async(url,opts={})=>{
    if(url.endsWith('/permissions'))return {permissions:data.rights}
    if(url.includes('/validation/')){data.checks.push([url,opts.body]);return url.endsWith(data.reject)&&data.reject?{result:'Failed',message:'Mapping rejected by VBR'}:{result:'Success'}}
    return pager(data.rows)
  }
  const send=async(url,opts={})=>{
    if(opts.mutation)data.writes.push([url,opts.body])
    if(url.includes('/tasks/'))return {id:mediaId,type:data.taskType,state:'Stopped',result:'Success'}
    if(url.includes('/createRecoveryMedia'))return {id:mediaId,type:data.taskType,state:'Working',result:'None'}
    if(url.includes('/recoveryMedia/')){assert.equal(opts.iso,true);return new Response('ISO')}
    if(url.includes('/recoveryTokens'))return {recoveryToken:'fixture-only',expirationDate:opts.body.expirationDate}
    if(url.includes('/restorePoints/'))return point
    if(url.includes('/restorePoints?'))return pager([point])
    if(url.includes('/objects?'))return pager(data.objects)
    if(url.includes('/recoveryAppliances?'))return pager(data.targets)
    if(url.endsWith('/diskManagement/init'))return {id:targetId,diskManagementSessionId:layoutId}
    if(url.endsWith('/diskManagement/automap'))return {success:true,restoreLayout:data.layout}
    if(url.endsWith('/applyDiskLayout'))return {}
    if(url.endsWith('/diskManagement/'+layoutId))return data.layout
    if(url.endsWith('/startVolumeRestore'))return {id:sessionId}
    throw Error('Unexpected native request '+url)
  }
  return {data,run:(action,value={},who=principal)=>agentVolumes(send,priv,who,volumeCommand.parse({...scope,...value,action}))}
}
test('agent token uses the native per-machine child chain; media requests the official ISO format and binds its task',async()=>{
  const {run,data}=fixture()
  assert.equal((await run('options')).tokenBackupId,childBackupId)
  await run('token',{confirm:backupId})
  assert.deepEqual(data.writes[0][1].backupIds,[childBackupId])
  const media=await run('media')
  assert.match(data.writes.at(-1)[0],/format=Iso&allowRemoteBmr=false$/)
  assert.equal(await (await run('download',{handle:media.handle})).text(),'ISO')
  await assert.rejects(run('download',{handle:media.handle},'other'))
  data.taskType='FlrDownload'
  await assert.rejects(run('download',{handle:media.handle}))
  data.taskType='RecoveryMedia';data.rights=data.rights.filter(r=>r!=='PerformRemoteBareMetalRecovery')
  await assert.rejects(run('media',{allowRemoteBmr:true}),/unavailable/)
  data.objects.push({...data.objects[0],id:id(80)});data.rows[0].childBackupId=null
  assert.equal((await run('options')).token,false)
  await assert.rejects(run('token',{confirm:backupId}))
})
test('appliance recovery requires a reviewed native disk mapping on the exact connected target and starts at most once',async()=>{
  const {run,data}=fixture()
  data.targets.push({...data.targets[0],id:id(72),isDetached:true})
  const opts=await run('options');assert.deepEqual(opts.targets,[{id:targetId,name:'Machine A'}])
  await assert.rejects(run('map',{targetId:id(72)}),/verified recovery appliance/)
  const mapped=await run('map',{targetId});assert.equal(mapped.ready,true)
  assert.equal(data.checks[1][1].shortInfos[0].restorePointId,restorePointId)
  await assert.rejects(run('start',{handle:mapped.handle,confirm:'Wrong'}))
  await assert.rejects(run('start',{handle:mapped.handle,confirm:'Machine A'},'other'))
  const remapped=await run('stageDisk',{handle:mapped.handle,sourceDisk:0,targetDisk:0})
  await assert.rejects(run('start',{handle:mapped.handle,confirm:'Machine A'}))
  const executions=await Promise.allSettled(Array.from({length:2},()=>run('start',{handle:remapped.handle,confirm:'Machine A'})))
  assert.equal(executions.filter(r=>r.status==='fulfilled').length,1)
  const starts=data.writes.filter(([path])=>path.endsWith('/startVolumeRestore'));assert.equal(starts.length,1)
  assert.deepEqual(starts[0][1].diskMappingContext,data.layout.volumeMatchingResults)
  assert.ok(data.checks.some(([path])=>path.endsWith('/checkVolumeMapping')))
})
test('changed layout, foreign source membership, native validation failures and malware preclude agent restore',async()=>{
  const {run,data}=fixture()
  data.reject='checkDiskExistence';await assert.rejects(run('map',{targetId}),/Mapping rejected/)
  assert.equal(data.writes.length,0);data.reject=''
  const mapped=await run('map',{targetId})
  data.layout.volumeMatchingResults={...data.layout.volumeMatchingResults,version:2}
  await assert.rejects(run('start',{handle:mapped.handle,confirm:'Machine A'}),/layout changed/)
  data.point.malwareStatus='Suspicious';await assert.rejects(run('token',{confirm:backupId}),/malware/)
  data.objects.push({...data.objects[0],id:id(81)});data.rows[0].id=id(77)
  await assert.rejects(run('map',{targetId}),/unavailable for this computer/)
  assert.equal(data.writes.filter(([path])=>path.endsWith('/startVolumeRestore')).length,0)
})
