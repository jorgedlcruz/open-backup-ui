// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename)
const {restoreAuthenticationSettings,loadRestoreAuthentication,normalizeRestoreDeviceCode,restoreCodeVerificationCapability}=require('../lib/vbm-recovery/restore-auth.ts')
const {authSchema,restoreSchema}=require('../lib/vbm-recovery/model.ts')
const {authPayload,restoreGroups}=require('../lib/vbm-recovery/paths.ts')
const sid='11111111-1111-4111-8111-111111111111',org='22222222-2222-4222-8222-222222222222',app='33333333-3333-4333-8333-333333333333',otherApp='44444444-4444-4444-8444-444444444444'

test('restore application hints choose workload settings and never return secrets or arbitrary organization fields',()=>{
  const raw={id:org,type:'Office365',name:'Tenant',officeName:'tenant.onmicrosoft.com',region:'Worldwide',sharePointOnlineSettings:{applicationId:app,password:'secret',applicationCertificate:'private'},exchangeOnlineSettings:{applicationId:otherApp,applicationSecret:'secret'},password:'secret',_links:{}}
  assert.deepEqual(restoreAuthenticationSettings(raw,'SharePoint'),{organizationName:'tenant.onmicrosoft.com',organizationType:'Office365',applicationId:app,region:'Worldwide',passwordAllowed:false})
  assert.equal(restoreAuthenticationSettings(raw,'OneDrive').applicationId,app)
  assert.equal(restoreAuthenticationSettings(raw,'Exchange').applicationId,otherApp)
  assert.equal(restoreAuthenticationSettings(raw,'Teams').applicationId,undefined)
  assert.equal(JSON.stringify(restoreAuthenticationSettings(raw,'SharePoint')).includes('secret'),false)
})

test('the Exchange certificate hint exposes only a valid fingerprint alongside the configured app',()=>{
  const thumbprint='ab'.repeat(20)
  const settings={useApplicationOnlyAuth:true,applicationId:app,applicationCertificateThumbprint:thumbprint,applicationCertificate:'private',applicationCertificatePassword:'secret'}
  const hints=(overrides={},workload='Exchange')=>restoreAuthenticationSettings({name:'Tenant',exchangeOnlineSettings:{...settings,...overrides}},workload)
  assert.deepEqual(hints(),{organizationName:'Tenant',passwordAllowed:false,applicationId:app,certificateThumbprint:thumbprint.toUpperCase()})
  for(const overrides of [{applicationCertificateThumbprint:'invalid'},{applicationId:null},{useApplicationOnlyAuth:false}])assert.equal(hints(overrides).certificateThumbprint,undefined)
  assert.equal(hints({},'SharePoint').certificateThumbprint,undefined)
})

test('native Explorer sessions can resolve the restore app from a single matching organization after a 404',async()=>{
  const {RecoveryError}=require('../lib/vbm-recovery/model.ts')
  const tenant={id:org,name:'tenant.onmicrosoft.com'}
  const calls=[]
  let listing={results:[tenant]},failure=new RecoveryError('Unavailable',404)
  const execute=async path=>{
    calls.push(path)
    if(path.endsWith('/organization'))throw failure
    if(path.includes('?'))return listing
    assert.equal(path,'/v8/Organizations/'+org)
    return {...tenant,exchangeOnlineSettings:{applicationId:app}}
  }
  const resolve=()=>loadRestoreAuthentication(execute,sid,'Exchange',undefined,'TENANT.onmicrosoft.com')
  assert.equal((await resolve()).applicationId,app)
  for(listing of [{results:[tenant,tenant]},{results:[{...tenant,name:'other'}]},{results:[tenant],_links:{next:{href:'more'}}}])await assert.rejects(resolve,/could not be identified/)
  calls.length=0
  failure=new RecoveryError('Denied',403)
  await assert.rejects(resolve,/Denied/)
  assert.equal(calls.length,1)
})

test('password sign-in is offered only for an explicitly on-premises Exchange or SharePoint workload',()=>{
  for(const type of ['Office365','Unknown',undefined])for(const workload of ['Exchange','SharePoint','OneDrive','Teams'])assert.equal(restoreAuthenticationSettings({type},workload).passwordAllowed,false)
  assert.equal(restoreAuthenticationSettings({type:'OnPremises'},'Exchange').passwordAllowed,true)
  assert.equal(restoreAuthenticationSettings({type:'OnPremises'},'SharePoint').passwordAllowed,true)
  assert.equal(restoreAuthenticationSettings({type:'OnPremises'},'OneDrive').passwordAllowed,false)
  assert.equal(restoreAuthenticationSettings({type:'Hybrid',isExchangeOnline:false,isExchange:true},'Exchange').passwordAllowed,true)
  assert.equal(restoreAuthenticationSettings({type:'Hybrid',isExchangeOnline:true,isExchange:true},'Exchange').passwordAllowed,false)
  assert.equal(restoreAuthenticationSettings({type:'Hybrid',isSharePointOnline:false,isSharepoint:true},'SharePoint').passwordAllowed,true)
})

test('application hints use the known organization or resolve it from this exact recovery session',async()=>{
  const calls=[],execute=async path=>{calls.push(path);return path.endsWith('/organization')?{id:org}:{name:'Tenant',sharePointOnlineSettings:{applicationId:app}}}
  assert.equal((await loadRestoreAuthentication(execute,sid,'SharePoint')).applicationId,app)
  assert.deepEqual(calls,[`/v8/RestoreSessions/${sid}/organization`,`/v8/Organizations/${org}`])
  calls.length=0;await loadRestoreAuthentication(execute,sid,'SharePoint',org)
  assert.deepEqual(calls,[`/v8/Organizations/${org}`])
  await assert.rejects(loadRestoreAuthentication(async()=>({id:'untrusted/path'}),sid,'SharePoint'),/could not be identified/)
})

test('restore device-code verification is explicitly unavailable and never claims authentication',()=>{
  assert.deepEqual(restoreCodeVerificationCapability(' CODE '),{verificationAvailable:false})
  assert.throws(()=>restoreCodeVerificationCapability(''))
})

test('legacy verification requests only validate the active session and never call Organization DeviceCode/check',async()=>{
  const {recoveryPost}=require('../lib/vbm-recovery/load.ts')
  const {recoveryTransport}=require('../lib/vbm-recovery/transport.ts')
  const calls=[]
  const execute=async(...args)=>{calls.push(args);return {id:sid,type:'Vesp',state:'Working'}}
  const result=await recoveryPost({execute,scope:'verification-test',sourceName:'test'},{action:'deviceCodeCheck',sessionId:sid,userCode:'CODE'})
  assert.deepEqual(result,{verificationAvailable:false})
  assert.deepEqual(calls,[[`/v8/RestoreSessions/${sid}`]])
  const transport=recoveryTransport({baseUrl:'https://source.test',token:'secret',refresh:async()=>null,fetcher:async()=>{throw Error('must not fetch')}})
  await assert.rejects(()=>transport('/v8/DeviceCode/check','POST',{userCode:'CODE'}),/Unsupported/)
})

test('sign-in codes require a valid lifetime and secure verification URL',()=>{
  const raw={userCode:'CODE',verificationUrl:'https://microsoft.com/devicelogin',expiresIn:900}
  assert.deepEqual(normalizeRestoreDeviceCode(raw),raw)
  assert.throws(()=>normalizeRestoreDeviceCode({...raw,expiresIn:0}))
  assert.throws(()=>normalizeRestoreDeviceCode({...raw,verificationUrl:'http://example.invalid'}),/invalid sign-in address/)
})

test('device-code restore payload sends only the code across workloads and excludes certificate authentication',()=>{
  const auth=authSchema.parse({mode:'deviceCode',userCode:'CODE',applicationId:app})
  for(const workload of ['Exchange','SharePoint','OneDrive','Teams']){
    const input=restoreSchema.parse({action:'restore',requestId:sid,sessionId:sid,workload,items:[{id:'item',ownerId:'owner',kind:'document'}],auth,options:{}})
    assert.deepEqual(authPayload(input),{userCode:'CODE'})
  }
  assert.throws(()=>authSchema.parse({...auth,userPassword:'secret'}))
  assert.throws(()=>authSchema.parse({...auth,applicationId:'not-an-app'}))
})


test('code issuance still binds the selected application and custom destination',async()=>{
  const {recoveryPost}=require('../lib/vbm-recovery/load.ts')
  const calls=[],receipt={userCode:'CODE',verificationUrl:'https://microsoft.com/devicelogin',expiresIn:900}
  const execute=async(...args)=>{calls.push(args);return args[0]===`/v8/RestoreSessions/${sid}`?{id:sid,type:'Vex',state:'Working'}:receipt}
  const result=await recoveryPost({execute,scope:'code-issuance-test',sourceName:'test'},{action:'deviceCode',sessionId:sid,targetApplicationId:app,targetRegion:'Worldwide',targetOrganizationName:'tenant.onmicrosoft.com'})
  assert.deepEqual(result,receipt)
  assert.deepEqual(calls,[[`/v8/RestoreSessions/${sid}`],[`/v8/RestoreSessions/${sid}/organization/restoreDeviceCode`,'POST',{targetApplicationId:app,targetRegion:'Worldwide',targetOrganizationName:'tenant.onmicrosoft.com'}]])
})

test('Exchange device-code original and alternate restore never include certificate selector fields',()=>{
  for(const destination of ['original','alternate']) {
    const input=restoreSchema.parse({action:'restore',requestId:sid,sessionId:sid,workload:'Exchange',items:[{id:'email',ownerId:org,kind:'item'}],auth:{mode:'deviceCode',userCode:'CODE',applicationId:app},options:{destination,mailbox:'user@tenant.test',folder:'Open Backup UI restore test'}})
    const [group]=restoreGroups(input,[{id:'email'}])
    assert.deepEqual(group.body,destination==='original'?{userCode:'CODE',items:[{id:'email'}]}:{userCode:'CODE',items:[{id:'email'}],mailbox:'user@tenant.test',folder:'Open Backup UI restore test',changedItems:false,deletedItems:true,markRestoredAsUnread:false})
  }
})

test('certificate and password restore authentication keep their separate documented fields',()=>{
  for(const workload of ['Exchange','SharePoint','OneDrive','Teams']) {
    const auth={mode:'certificate',applicationId:app,applicationCertificate:'base64',applicationCertificatePassword:'certificate-password',impersonationAccountName:'operator@tenant.test'}
    const input=restoreSchema.parse({action:'restore',requestId:sid,sessionId:sid,workload,items:[{id:'item',ownerId:org,kind:workload==='Exchange'?'item':'document'}],auth,options:{}})
    const expected={applicationId:app,applicationCertificate:'base64',applicationCertificatePassword:'certificate-password',...(workload==='Exchange'?{impersonationAccountName:'operator@tenant.test'}:{})}
    assert.deepEqual(authPayload(input),expected)
    if(workload==='Exchange')assert.deepEqual(restoreGroups(input,[{id:'item'}])[0].body,{...expected,items:[{id:'item'}]})
    input.auth=authSchema.parse({mode:'credentials',userName:'operator',userPassword:'password'})
    assert.deepEqual(authPayload(input),{userName:'operator',userPassword:'password'})
  }
})
