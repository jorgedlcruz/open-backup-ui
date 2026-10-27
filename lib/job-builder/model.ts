import { z } from 'zod'

export const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] as const
export const platforms = ['VSphere','HyperV'] as const
export const profileKinds = ['retention','guest','schedule'] as const
export type ProfileKind = typeof profileKinds[number]
export const kindLabels: Record<ProfileKind,string> = { retention:'Retention & full backups', guest:'Guest processing', schedule:'Schedule & retries' }
const uuid = z.string().uuid()
const day = z.enum(days)
const dayList = z.array(day).max(7).refine(v => new Set(v).size === v.length, 'Choose each day once.')
const integer = (min:number,max:number) => z.number().int().min(min).max(max)
export const retentionSchema = z.object({
  type:z.enum(['Days','RestorePoints']), quantity:integer(1,9999),
  synthetic:z.boolean(), syntheticDays:dayList, active:z.boolean(), activeDays:dayList,
  healthCheck:z.boolean(), healthDays:dayList,
  gfsWeeks:integer(0,9999), gfsMonths:integer(0,999), gfsYears:integer(0,999),
}).strict().superRefine((v,c) => {
  for(const [enabled,key] of [[v.synthetic,'syntheticDays'],[v.active,'activeDays'],[v.healthCheck,'healthDays']] as const)
    if(enabled && !v[key].length)c.addIssue({code:'custom',path:[key],message:'Select at least one day.'})
  if((v.gfsWeeks || v.gfsMonths || v.gfsYears) && !v.synthetic && !v.active)c.addIssue({code:'custom',path:['gfsWeeks'],message:'Choose a full-backup cadence for GFS retention.'})
})
export const guestSchema = z.object({
  applicationAware:z.boolean(), indexing:z.boolean(), credentialId:z.union([uuid,z.literal('')]),
  credentialType:z.enum(['Standard','Linux','ManagedService']), vss:z.enum(['RequireSuccess','IgnoreFailures']),
}).strict().superRefine((v,c) => {
  if((v.applicationAware || v.indexing) && !v.credentialId)c.addIssue({code:'custom',path:['credentialId'],message:'Select a guest OS credential stored in VBR.'})
})
export const scheduleSchema = z.object({
  mode:z.enum(['manual','daily','periodic']), time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/,'Use a valid local time.'),
  days:dayList, interval:integer(1,999), unit:z.enum(['Hours','Minutes']),
  retry:z.boolean(), retryCount:integer(1,99), retryMinutes:integer(1,1440),
}).strict().superRefine((v,c) => {if(v.mode==='daily' && !v.days.length)c.addIssue({code:'custom',path:['days'],message:'Select at least one run day.'})})
export type Retention = z.infer<typeof retentionSchema>
export type Guest = z.infer<typeof guestSchema>
export type Schedule = z.infer<typeof scheduleSchema>
export const defaults = {
  retention:{type:'Days',quantity:7,synthetic:true,syntheticDays:['saturday'],active:false,activeDays:['sunday'],healthCheck:false,healthDays:['sunday'],gfsWeeks:0,gfsMonths:0,gfsYears:0} satisfies Retention,
  guest:{applicationAware:false,indexing:false,credentialId:'',credentialType:'Standard',vss:'RequireSuccess'} satisfies Guest,
  schedule:{mode:'daily',time:'22:00',days:[...days],interval:4,unit:'Hours',retry:true,retryCount:3,retryMinutes:10} satisfies Schedule,
}
const profileMeta = { name:z.string().trim().min(1,'Give this profile a name.').max(100), description:z.string().trim().max(500) }
export const profileInput = z.discriminatedUnion('kind',[
  z.object({...profileMeta,kind:z.literal('retention'),settings:retentionSchema}).strict(),
  z.object({...profileMeta,kind:z.literal('guest'),settings:guestSchema}).strict(),
  z.object({...profileMeta,kind:z.literal('schedule'),settings:scheduleSchema}).strict(),
])
export type ProfileInput = z.infer<typeof profileInput>
export type Profile = ProfileInput & {id:string; revision:number; updatedAt:string}
const recordMeta = {id:uuid,revision:integer(1,1000000),updatedAt:z.string().datetime()}
export const profileSchema = z.discriminatedUnion('kind',[profileInput.options[0].extend(recordMeta),profileInput.options[1].extend(recordMeta),profileInput.options[2].extend(recordMeta)])
export const profileEnvelope = z.object({schemaVersion:z.literal(1),profile:profileInput}).strict()

export const objectSchema = z.object({
  platform:z.enum(platforms),type:z.string().min(1).max(80),hostName:z.string().min(1).max(500),name:z.string().min(1).max(1000),
  objectId:z.string().min(1).max(1000),urn:z.string().max(3000).optional(),parentObjectId:z.string().max(1000).optional(),size:z.string().max(100).optional(),
}).strict()
export type JobObject = z.infer<typeof objectSchema>
export const objectKey = (v:Pick<JobObject,'platform'|'hostName'|'type'|'objectId'>) => [v.platform,v.hostName.toLowerCase(),v.type,v.objectId].join('|')
export const allowedTypes:Record<typeof platforms[number],readonly string[]> = {
  VSphere:['VirtualMachine','VirtualApp','ResourcePool','Host','Cluster','Datacenter','Folder','Tag','Category','Datastore','DatastoreCluster'],
  HyperV:['VirtualMachine','Host','Cluster','Scvmm','VMGroup','HostGroup','ManagementGroup'],
}
export const draftSchema = z.object({
  sourceKey:z.string().regex(/^[a-f0-9]{64}$/),platform:z.enum(platforms),name:z.string().trim().min(1,'Enter a job name.').max(128),description:z.string().max(2048),highPriority:z.boolean(),
  includes:z.array(objectSchema).min(1,'Select at least one workload or container.').max(500),excludes:z.array(objectSchema).max(500),repositoryId:z.string().uuid('Choose a backup repository.'),
  proxyMode:z.enum(['auto','selected','onHost']),proxyIds:z.array(uuid).max(50),
  retention:retentionSchema,guest:guestSchema,schedule:scheduleSchema,
}).strict().superRefine((v,c)=>{
  const seen=new Set<string>()
  for(const [field,objects] of [['includes',v.includes],['excludes',v.excludes]] as const)for(const [index,item] of objects.entries()) {
    if(item.platform!==v.platform || !allowedTypes[v.platform].includes(item.type))c.addIssue({code:'custom',path:[field,index],message:'This object does not match the selected platform or supported object types.'})
    const key=objectKey(item)
    if(seen.has(key))c.addIssue({code:'custom',path:[field,index],message:'An object cannot be duplicated or both included and excluded.'})
    seen.add(key)
  }
  if(v.proxyMode==='selected' && !v.proxyIds.length)c.addIssue({code:'custom',path:['proxyIds'],message:'Select at least one backup proxy.'})
  if(v.platform==='VSphere' && v.proxyMode==='onHost')c.addIssue({code:'custom',path:['proxyMode'],message:'On-host processing is only available for Hyper-V.'})
})
export type Draft = z.infer<typeof draftSchema>
// An unfinished draft may have empty required selections; retain only known,
// bounded fields when restoring it from this browser tab.
export const savedDraftSchema = z.object({...draftSchema.shape,
  name:z.string().max(128),repositoryId:z.union([uuid,z.literal('')]),includes:z.array(objectSchema).max(500),
  retention:z.object(retentionSchema.shape).strict(),guest:z.object(guestSchema.shape).strict(),schedule:z.object(scheduleSchema.shape).strict(),
}).strict()
export const newDraft = (platform:Draft['platform'],sourceKey=''):Draft => ({sourceKey,platform,name:'',description:'Created with Open Backup UI',highPriority:false,includes:[],excludes:[],repositoryId:'',proxyMode:platform==='HyperV'?'onHost':'auto',proxyIds:[],...structuredClone(defaults)})
export function profileSummary(kind:ProfileKind,value:Retention|Guest|Schedule):string {
  if(kind==='retention') {const v=value as Retention;return `${v.quantity} ${v.type==='Days'?'days':'restore points'} · ${v.synthetic?'synthetic fulls':v.active?'active fulls':'incremental forever'}${v.gfsWeeks||v.gfsMonths||v.gfsYears?' · GFS':''}`}
  if(kind==='guest') {const v=value as Guest;return `${v.applicationAware?'Application-aware':'Crash-consistent'}${v.indexing?' · file indexing':''}`}
  const v=value as Schedule
  return v.mode==='manual'?'Run manually':v.mode==='periodic'?`Every ${v.interval} ${v.unit.toLowerCase()}`:`${v.days.length===7?'Every day':v.days.length===5 && v.days.every(d=>!['saturday','sunday'].includes(d))?'Weekdays':v.days.map(d=>d.slice(0,3)).join(', ')} at ${v.time}`
}
export function issues(value:unknown) {const result=draftSchema.safeParse(value);return result.success?[]:result.error.issues.map(e=>({field:e.path.join('.'),message:e.message}))}

// These fragments follow the supplied VBR 1.3-rev2 JobSpec schemas. Profile IDs,
// names and revisions never enter the native job payload: settings are snapshots.
export function compileRetention(v:Retention) {
  const weekly=(isEnabled:boolean,days:Retention['syntheticDays'])=>({isEnabled,...(isEnabled?{weekly:{isEnabled:true,days:days.map(nativeDay)}}:{})})
  return {retentionPolicy:{type:v.type,quantity:v.quantity},gfsPolicy:{isEnabled:!!(v.gfsWeeks||v.gfsMonths||v.gfsYears),
    weekly:{isEnabled:v.gfsWeeks>0,...(v.gfsWeeks?{keepForNumberOfWeeks:v.gfsWeeks,desiredTime:'Sunday'}:{})},
    monthly:{isEnabled:v.gfsMonths>0,...(v.gfsMonths?{keepForNumberOfMonths:v.gfsMonths,desiredTime:'First'}:{})},
    yearly:{isEnabled:v.gfsYears>0,...(v.gfsYears?{keepForNumberOfYears:v.gfsYears,desiredTime:'January'}:{})}},
    advancedSettings:{backupModeType:'Incremental',syntheticFulls:weekly(v.synthetic,v.syntheticDays),activeFulls:weekly(v.active,v.activeDays),backupHealth:weekly(v.healthCheck,v.healthDays)}}
}
export function compileSchedule(v:Schedule) {
  return {runAutomatically:v.mode!=='manual',daily:v.mode==='daily'?{isEnabled:true,localTime:v.time,dailyKind:v.days.length===7?'Everyday':'SelectedDays',days:v.days.map(nativeDay)}:{isEnabled:false},
    periodically:v.mode==='periodic'?{isEnabled:true,periodicallyKind:v.unit,frequency:v.interval,startTimeWithinAnHour:0}:{isEnabled:false},
    retry:{isEnabled:v.mode!=='manual'&&v.retry,...(v.retry?{retryCount:v.retryCount,awaitMinutes:v.retryMinutes}:{})}}
}
const nativeDay=(value:typeof days[number])=>value[0].toUpperCase()+value.slice(1)
export function compileGuest(v:Guest,includes:JobObject[]) {
  return {appAwareProcessing:{isEnabled:v.applicationAware,...(v.applicationAware?{appSettings:includes.map(item=>({vmObject:compileObject(item),vss:v.vss,transactionLogs:'CopyOnly'}))}:{})},
    guestFSIndexing:{isEnabled:v.indexing,...(v.indexing?{indexingSettings:includes.map(item=>({vmObject:compileObject(item),WindowsIndexing:{guestFSIndexingMode:'IndexAll'},LinuxIndexing:{guestFSIndexingMode:'IndexAll'}}))}:{})},
    ...((v.applicationAware||v.indexing)?{guestInteractionProxies:{autoSelectEnabled:true,proxyIds:[]},guestCredentials:{useAgentManagementCredentials:false,credentials:{credentialsId:v.credentialId,credentialsType:v.credentialType}}}:{})}
}
function compileObject(v:JobObject) {return {platform:v.platform,hostName:v.hostName,type:v.type,name:v.name,objectId:v.objectId,...(v.urn?{urn:v.urn}:{})}}
export function compileJob(input:unknown) {
  const v=draftSchema.parse(input),retention=compileRetention(v.retention)
  const proxy={autoSelectEnabled:v.proxyMode!=='selected',proxyIds:v.proxyMode==='selected'?v.proxyIds:[]}
  return {name:v.name,description:v.description,type:v.platform==='VSphere'?'VSphereBackup':'HyperVBackup',isHighPriority:v.highPriority,
    virtualMachines:{includes:v.includes.map(compileObject),...(v.excludes.length?{excludes:{vms:v.excludes.map(compileObject)}}:{})},
    storage:{backupRepositoryId:v.repositoryId,backupProxies:v.platform==='VSphere'?proxy:v.proxyMode==='onHost'?{proxyType:'OnHost'}:{proxyType:'OffHost',offHostSettings:{...proxy,failoverToOnHostBackup:true}},...retention},
    guestProcessing:compileGuest(v.guest,v.includes),schedule:compileSchedule(v.schedule)}
}
