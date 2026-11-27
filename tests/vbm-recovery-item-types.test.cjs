// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),ts=require('typescript')
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename)
const {recoveryItemVisualType}=require('../lib/vbm-recovery/item-type.ts')
const item=(changes={})=>({workload:'SharePoint',kind:'document',isFolder:false,name:'report.docx',raw:{},...changes})

test('backup owners have distinct visuals; archive and public flags come from API metadata',()=>{
  for(const [workload,expected] of [['Exchange','mailbox'],['OneDrive','drive'],['SharePoint','site'],['Teams','team']])assert.equal(recoveryItemVisualType(item({workload,kind:'owner'})),expected)
  assert.equal(recoveryItemVisualType(item({workload:'Exchange',kind:'owner',raw:{isArchive:true}})),'archive-mailbox')
  assert.equal(recoveryItemVisualType(item({workload:'Exchange',kind:'owner',raw:{isPublic:true}})),'public-mailbox')
  assert.equal(recoveryItemVisualType(item({kind:'owner',parentId:'parent-site'})),'subsite')
  assert.equal(recoveryItemVisualType(item({kind:'owner',parentId:'root'})),'site')
})

test('all eight documented Exchange item families retain custom subclasses and meeting messages',()=>{
  for(const [itemClass,expected] of Object.entries({'IPM.Note':'message','IPM.Appointment':'appointment','IPM.Contact':'contact','IPM.DistList':'contact-group','IPM.Post':'discussion','IPM.Activity':'journal','IPM.StickyNote':'note','IPM.Task':'task'})) {
    assert.equal(recoveryItemVisualType(item({workload:'Exchange',kind:'item',itemClass})),expected)
    assert.equal(recoveryItemVisualType(item({workload:'Exchange',kind:'item',raw:{itemClass:itemClass+'.Custom'}})),expected)
  }
  assert.equal(recoveryItemVisualType(item({workload:'Exchange',kind:'item',itemClass:' IPM.Schedule.Meeting.Resp.Pos '})),'appointment')
  assert.equal(recoveryItemVisualType(item({workload:'Exchange',kind:'item',itemClass:'REPORT.IPM.Note.NDR'})),'message')
  assert.equal(recoveryItemVisualType(item({workload:'Exchange',kind:'item',itemClass:'IPM.TaskRequest.Accept'})),'task')
})

test('unknown Exchange classes stay neutral rather than being guessed from subjects or lookalike prefixes',()=>{
  for(const itemClass of ['', 'Vendor.Custom', 'IPM.TaskSomethingElse', 'IPM.Contactless'])assert.equal(recoveryItemVisualType(item({workload:'Exchange',kind:'item',itemClass,name:'Calendar.xlsx'})),'exchange-item')
})

test('every documented Exchange folder type and category is recognized without English display-name heuristics',()=>{
  const types={Journal:'journal-folder',Task:'tasks-folder',StickyNote:'notes-folder',Contact:'contacts-folder',Appointment:'calendar-folder',None:'folder'}
  const categories={Inbox:'inbox-folder',Outbox:'outbox-folder',Sent:'sent-folder',Deleted:'deleted-folder',Drafts:'drafts-folder',PermanentlyDeletedItems:'permanently-deleted-folder',Purges:'purges-folder',DiscoveryHolds:'holds-folder',Conflicts:'conflicts-folder',SyncIssues:'sync-folder',LocalFailures:'local-failures-folder',ServerFailures:'server-failures-folder',Junk:'junk-folder',Versions:'versions-folder',TeamsMessagesData:'teams-messages-folder',None:'folder'}
  for(const [type,expected] of Object.entries(types))assert.equal(recoveryItemVisualType(item({workload:'Exchange',kind:'folder',isFolder:true,name:'Renamed folder',raw:{type}})),expected)
  for(const [category,expected] of Object.entries(categories))assert.equal(recoveryItemVisualType(item({workload:'Exchange',kind:'folder',isFolder:true,name:'Bandeja de entrada',raw:{category,type:'None'}})),expected)
  assert.equal(recoveryItemVisualType(item({workload:'Exchange',kind:'folder',name:'Inbox',raw:{type:'None',category:'None'}})),'folder')
})

test('SharePoint libraries, lists, their folder types and list items are distinct',()=>{
  for(const [kind,expected] of [['library','library'],['list','list'],['item','list-item']])assert.equal(recoveryItemVisualType(item({kind,name:'report.pdf'})),expected)
  assert.equal(recoveryItemVisualType(item({kind:'folder',raw:{type:'LibraryFolder'}})),'library-folder')
  assert.equal(recoveryItemVisualType(item({kind:'folder',raw:{type:'ListFolder'}})),'list-folder')
  assert.equal(recoveryItemVisualType(item({kind:'document',raw:{type:'ListFolder'}})),'list-folder')
  assert.equal(recoveryItemVisualType(item({name:'Home.aspx'})),'web-page')
})

test('Teams channel privacy, posts and tabs use metadata, while folder markers override file extensions',()=>{
  for(const [type,expected] of [['Standard','channel'],['Private','private-channel'],['Shared','shared-channel'],['UnknownFutureValue','channel']])assert.equal(recoveryItemVisualType(item({workload:'Teams',kind:'channel',raw:{type}})),expected)
  assert.equal(recoveryItemVisualType(item({workload:'Teams',kind:'post'})),'post')
  assert.equal(recoveryItemVisualType(item({workload:'Teams',kind:'tab',raw:{type:'futureCustomApp'}})),'tab')
  assert.equal(recoveryItemVisualType(item({workload:'Teams',kind:'file',name:'Old files.zip',raw:{fileType:'Folder'}})),'folder')
  assert.equal(recoveryItemVisualType(item({workload:'OneDrive',name:'Vacation.jpg',raw:{isFolder:true}})),'folder')
})

test('common file extensions are case-insensitive and never override an API collection kind',()=>{
  const examples={'report.DOCX':'text-document','budget.XLSX':'spreadsheet','slides.pptx':'presentation','reference.pdf':'pdf','photo.HEIC':'image','clip.mp4':'video','meeting.m4a':'audio','backup.tar.gz':'archive','settings.json':'code','Home.aspx':'web-page','unknown.blob':'document','no-extension':'document','photo.jpg.exe':'document'}
  for(const [name,expected] of Object.entries(examples))assert.equal(recoveryItemVisualType(item({name})),expected)
  assert.equal(recoveryItemVisualType(item({kind:'list',name:'Budget.xlsx'})),'list')
  assert.equal(recoveryItemVisualType(item({isFolder:true,name:'Folder.pdf'})),'folder')
})

test('minimal and unknown metadata remains safe and does not follow resource URLs',()=>{
  assert.equal(recoveryItemVisualType({workload:'OneDrive',kind:'document',isFolder:false}),'document')
  assert.equal(recoveryItemVisualType(item({name:undefined,raw:{name:'Plan.PDF',_links:{self:{href:'https://not-requested.invalid'}}}})),'pdf')
  assert.equal(recoveryItemVisualType(item({name:undefined,raw:{name:{unexpected:true},type:{bad:true}}})),'document')
})
