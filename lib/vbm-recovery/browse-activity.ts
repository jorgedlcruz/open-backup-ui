// Open Backup UI v1.3.0
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { replaceFile } from '../server/atomic-file'
import { browseSchema, sessionIdSchema, workloadSchema, type BrowseInput, type RecoveryItem } from './model'

const scopeSchema=z.string().regex(/^[a-f0-9]{64}$/)
const locationId=z.string().min(1).max(2048)
const eventSchema=z.object({
  id:z.string().uuid(),timestamp:z.string().datetime(),
  action:z.enum(['Backed-up objects loaded','Folder list loaded','Folder contents loaded','Libraries loaded','Lists loaded','Channels loaded','Item versions loaded','Search completed','Item preview opened','Original download opened']),
  workload:workloadSchema,resourceKind:browseSchema.shape.kind,source:z.string().max(512),
  ownerId:locationId.optional(),parentId:locationId.optional(),channelId:locationId.optional(),
  objectName:z.string().max(512).optional(),parentName:z.string().max(512).optional(),
  itemId:locationId.optional(),actor:z.string().max(512).optional(),
  itemCount:z.number().int().min(0).max(10000),durationMs:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  cached:z.boolean().optional(),
  sessionCheckMs:z.number().int().nonnegative().optional(),sourceReadMs:z.number().int().nonnegative().optional(),
}).strict()
const fileSchema=z.object({version:z.literal(1),scope:scopeSchema,sessionId:sessionIdSchema,events:z.array(eventSchema).max(500)}).strict()
export type BrowseActivityEvent=z.infer<typeof eventSchema>
type ActivityInput=Omit<BrowseActivityEvent,'id'|'timestamp'>
type ActivityKey={scope:string;sessionId:string}
export type BrowseActivityAvailability='available'|'unavailable'
export type BrowseActivityPage={events:BrowseActivityEvent[];availability:BrowseActivityAvailability}
const retention=24*60*60*1000,maxEvents=500,maxFileBytes=8*1024*1024

/** Only container names read from the source can label a later read. No item content or browser labels. */
export function createBrowseLocationCache(clock:()=>number=Date.now) {
  const sessions=new Map<string,{updated:number;names:Map<string,{name:string;updated:number}>}>()
  const key=(scope:string,sessionId:string)=>JSON.stringify([scope,sessionId.toLowerCase()])
  const nameKey=(workload:string,kind:string,id:string,ownerId='',channelId='')=>JSON.stringify([workload,kind,ownerId,channelId,id])
  const session=(scope:string,sessionId:string,create=false)=>{
    if(!scopeSchema.safeParse(scope).success||!sessionIdSchema.safeParse(sessionId).success)return undefined
    const now=clock(),id=key(scope,sessionId)
    for(const [old,value] of sessions)if(value.updated<now-retention)sessions.delete(old)
    const value=sessions.get(id)||(create?{updated:now,names:new Map<string,{name:string;updated:number}>()}:undefined)
    if(value){value.updated=now;for(const [old,name]of value.names)if(name.updated<now-retention)value.names.delete(old);sessions.delete(id);sessions.set(id,value)}
    while(sessions.size>128)sessions.delete(sessions.keys().next().value!)
    return value
  }
  return {
    remember(scope:string,sessionId:string,items:RecoveryItem[]) {
      const value=session(scope,sessionId,true);if(!value)return
      for(const item of items) {
        if(!['owner','folder','library','list','channel'].includes(item.kind))continue
        // normalizeItems can fall back to subject/email/URL; those are deliberately not name evidence here.
        const rawName=[item.raw.name,item.raw.displayName,item.raw.fullName,item.raw.title].find((name):name is string=>typeof name==='string'&&!!name.trim())
        if(!rawName)continue
        const name=rawName.trim()
        if(name.includes('@'))continue
        const id=nameKey(item.workload,item.kind,item.id,item.kind==='owner'?'':item.ownerId||'',item.kind==='channel'?'':item.channelId||'')
        value.names.delete(id);value.names.set(id,{name:name.slice(0,512).replace(/[\uD800-\uDBFF]$/,''),updated:clock()})
      }
      while(value.names.size>512)value.names.delete(value.names.keys().next().value!)
    },
    resolve(scope:string,input:BrowseInput):{objectName?:string;parentName?:string} {
      const value=session(scope,input.sessionId);if(!value)return {}
      const get=(kind:string,id:string,ownerId='',channelId='')=>value.names.get(nameKey(input.workload,kind,id,ownerId,channelId))?.name
      const objectName=input.ownerId?get('owner',input.ownerId):undefined
      let parentName:string|undefined
      if(input.parentId&&input.parentId!=='root'&&input.parentId!=='-1') {
        const kinds=input.scopeKind&&['folder','library','list'].includes(input.scopeKind)?[input.scopeKind]:['folder','library','list']
        const names=kinds.flatMap(kind=>{const name=get(kind,input.parentId!,input.ownerId||'',input.channelId||'');return name?[name]:[]})
        if(names.length===1)parentName=names[0]
      }else if(input.channelId)parentName=get('channel',input.channelId,input.ownerId||'')
      return {...(objectName?{objectName}:{}),...(parentName?{parentName}:{})}
    },
  }
}

/** Local application activity, never a Veeam audit event or proof of an individual user's identity. */
export function createBrowseActivityStore(base:string,clock:()=>number=Date.now) {
  const pending=new Map<string,Promise<unknown>>(),failed=new Set<string>()
  const target=(key:ActivityKey)=>path.join(base,scopeSchema.parse(key.scope),sessionIdSchema.parse(key.sessionId).toLowerCase()+'.json')
  const identity=(key:ActivityKey)=>JSON.stringify([key.scope,key.sessionId.toLowerCase()])
  const rememberFailure=(key:ActivityKey)=>{failed.add(identity(key));while(failed.size>2000)failed.delete(failed.values().next().value!)}
  const retained=(events:BrowseActivityEvent[])=>events.filter(event=>Date.parse(event.timestamp)>=clock()-retention && Date.parse(event.timestamp)<=clock()+60000).slice(-maxEvents)
  const readFile=async(key:ActivityKey)=>{
    const filename=target(key)
    try {
      if((await fs.stat(filename)).size>maxFileBytes)throw Error('Activity record is too large.')
      const value=fileSchema.parse(JSON.parse(await fs.readFile(filename,'utf8')))
      if(value.scope!==key.scope || value.sessionId!==key.sessionId.toLowerCase())throw Error('Activity scope mismatch.')
      return retained(value.events)
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error}
  }
  return {
    async read(key:ActivityKey):Promise<BrowseActivityPage> {
      try {
        await pending.get(identity(key))?.catch(()=>{})
        return {events:(await readFile(key)).reverse(),availability:failed.has(identity(key))?'unavailable':'available'}
      }catch{return {events:[],availability:'unavailable'}}
    },
    async append(key:ActivityKey,input:ActivityInput):Promise<BrowseActivityAvailability> {
      const id=identity(key),previous=pending.get(id)
      const operation=(previous||Promise.resolve()).catch(()=>{}).then(async()=>{
        const filename=target(key),now=clock(),event=eventSchema.parse({...input,id:randomUUID(),timestamp:new Date(now).toISOString()}),events=await readFile(key)
        // The tree and contents grid can request the same resource together. Avoid duplicate read receipts.
        const same=(old:BrowseActivityEvent)=>old.action===event.action&&old.workload===event.workload&&old.resourceKind===event.resourceKind&&old.ownerId===event.ownerId&&old.parentId===event.parentId&&old.channelId===event.channelId&&old.itemCount===event.itemCount
        if(!event.itemId && !event.cached && events.some(old=>!old.cached&&now-Date.parse(old.timestamp)<2000&&same(old))){failed.delete(id);return}
        const value=fileSchema.parse({version:1,scope:key.scope,sessionId:key.sessionId.toLowerCase(),events:[...events,event].slice(-maxEvents)})
        let serialized=JSON.stringify(value)
        while(Buffer.byteLength(serialized,'utf8')>maxFileBytes&&value.events.length>1){value.events.shift();serialized=JSON.stringify(value)}
        const temporary=filename+'.'+randomUUID()
        await fs.mkdir(path.dirname(filename),{recursive:true,mode:0o700})
        try {await fs.writeFile(temporary,serialized,{flag:'wx',mode:0o600});await replaceFile(temporary,filename)}
        finally {await fs.unlink(temporary).catch(()=>{})}
        failed.delete(id)
      })
      pending.set(id,operation)
      try {await operation;return 'available'}
      catch {rememberFailure(key);return 'unavailable'}
      finally {if(pending.get(id)===operation)pending.delete(id)}
    },
  }
}

// Instantiation does not create a directory. Only a completed source read writes a receipt.
const activityStore=createBrowseActivityStore(path.join(process.cwd(),'data','vbm-recovery-activity'))
const locationCache=createBrowseLocationCache()
export function recordContentAccess(scope:string,sessionId:string,event:Pick<ActivityInput,'actor'|'source'|'durationMs'|'workload'|'ownerId'|'channelId'|'itemId'>&{action:'Item preview opened'|'Original download opened'}) {
  const kind=event.workload==='Exchange'?'items':event.workload==='Teams'?'files':'documents'
  return activityStore.append({scope,sessionId},{...event,resourceKind:kind,itemCount:1,...locationCache.resolve(scope,{sessionId,kind,workload:event.workload,ownerId:event.ownerId,offset:0,limit:1})})
}
export const rememberBrowseLocations=(scope:string,sessionId:string,items:RecoveryItem[])=>locationCache.remember(scope,sessionId,items)
export const readBrowseActivity=(scope:string,sessionId:string)=>activityStore.read({scope,sessionId})
export function recordBrowseActivity(scope:string,source:string,input:BrowseInput,itemCount:number,durationMs:number,search=false,cached=false,timing:{sessionCheckMs?:number;sourceReadMs?:number}={}) {
  const action:BrowseActivityEvent['action']=search?'Search completed':input.kind==='owners'?'Backed-up objects loaded':input.kind==='folders'?'Folder list loaded':input.kind==='libraries'?'Libraries loaded':input.kind==='lists'?'Lists loaded':input.kind==='channels'?'Channels loaded':input.kind==='versions'?'Item versions loaded':'Folder contents loaded'
  return activityStore.append({scope,sessionId:input.sessionId},{action,workload:input.workload,resourceKind:input.kind,source,ownerId:input.ownerId,parentId:input.parentId,channelId:input.channelId,...locationCache.resolve(scope,input),itemCount,...timing,durationMs:Math.max(0,Math.round(durationMs)),...(cached?{cached:true}:{})})
}
