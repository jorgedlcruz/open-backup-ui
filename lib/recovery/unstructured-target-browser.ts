// Open Backup UI v1.2.0
import {createHmac,timingSafeEqual} from 'node:crypto'
import {z} from 'zod'
import type {RecoverySend} from '../server/vbr-recovery'
import {unstructuredTargets,family} from './unstructured-catalog'
import {VbrRecoveryError} from './error'
import {targetFolderPath,targetPathWithin,type TargetFolder} from '../restore-points/target-folders'

const guid=z.string().uuid().transform(value=>value.toLowerCase())
const nativeSession=z.object({sessionId:guid,serverId:guid,serverName:z.string().optional(),timeout:z.number().int().positive(),
  pathSeparator:z.enum(['/','\\']),rootPath:z.string().max(8192)})
const nativeItem=z.object({name:z.string(),itemType:z.string(),fullName:z.string().max(8192).nullish(),isSymbolicLink:z.boolean().optional()})
const nativePage=z.object({path:z.string().max(8192),items:z.array(nativeItem),pagination:z.object({total:z.number().int().nonnegative(),
  count:z.number().int().nonnegative().optional(),skip:z.number().int().nonnegative().optional()}).nullish()})
const base='/api/v1/inventory/unstructuredDataServers'
const lifetime=10*60_000
type Context={sourceKey:string;cacheKey:string;secret:string;send:RecoverySend}
export type TargetBrowseInput={action:'startTargetBrowse';sessionId:string;destinationId:string}|{
  action:'browseTarget'|'stopTargetBrowse';sessionId:string;destinationId:string;browseSessionId:string;browseKey:string;path?:string;skip?:number;limit?:number}
const denied=()=>new VbrRecoveryError('This destination browser is unavailable. Open the folder browser again.',409)
function signature(ctx:Context,input:{sessionId:string;destinationId:string;browseSessionId:string},issued:number){
  return createHmac('sha256',ctx.secret).update(JSON.stringify(['nas-destination-browser',ctx.sourceKey,ctx.cacheKey,input.sessionId,input.destinationId,input.browseSessionId,issued])).digest('base64url')
}
function checkKey(ctx:Context,input:Exclude<TargetBrowseInput,{action:'startTargetBrowse'}>){
  const match=/^(\d{13})\.([\w-]{43})$/.exec(input.browseKey)
  if(!match)throw denied()
  const issued=Number(match[1]),elapsed=Date.now()-issued,actual=Buffer.from(match[2]),expected=Buffer.from(signature(ctx,input,issued))
  if(elapsed<0||elapsed>(input.action==='stopTargetBrowse'?24*60*60_000:lifetime)||actual.length!==expected.length||!timingSafeEqual(actual,expected))throw denied()
}
export const targetBrowsePermissions=['CopyUnstructuredDataFlrItem','ViewUnstructuredDataServers','StartBrowseUnstructuredDataServer','BrowseUnstructuredDataServer','StopBrowseUnstructuredDataServer'] as const
export async function unstructuredTargetBrowse(ctx:Context,input:TargetBrowseInput,rights:Set<string>){
  if(input.action==='stopTargetBrowse'){
    if(!rights.has('StopBrowseUnstructuredDataServer'))throw denied()
  }else if(!targetBrowsePermissions.every(right=>rights.has(right)))throw denied()
  if(input.action==='startTargetBrowse'){
    const targets=await unstructuredTargets(path=>ctx.send(path))
    const target=targets.data.find(row=>row.id===input.destinationId&&family(row.type)==='nas')
    if(!target)throw new VbrRecoveryError('Select a destination from the connected VBR source.',409)
    const session=nativeSession.parse(await ctx.send(base+'/'+input.destinationId+'/startBrowse?timeout=10',{method:'POST'}))
    if(session.serverId!==input.destinationId||!targetPathWithin(session.rootPath,session.rootPath,session.pathSeparator))throw denied()
    const issued=Date.now(),address={...input,browseSessionId:session.sessionId}
    return {browseSessionId:session.sessionId,browseKey:issued+'.'+signature(ctx,address,issued),serverId:session.serverId,
      serverName:session.serverName||target.name,pathSeparator:session.pathSeparator,rootPath:session.rootPath,expiresAt:new Date(issued+lifetime).toISOString()}
  }
  checkKey(ctx,input)
  const path=base+'/sessions/'+input.browseSessionId
  let session:z.infer<typeof nativeSession>
  try{session=nativeSession.parse(await ctx.send(path))}catch(error){
    if(input.action==='stopTargetBrowse'&&error instanceof VbrRecoveryError&&error.status===404)return {closed:true}
    throw error
  }
  if(session.sessionId!==input.browseSessionId||session.serverId!==input.destinationId)throw denied()
  if(input.action==='stopTargetBrowse'){
    await ctx.send(path+'/stop',{method:'POST'})
    return {closed:true}
  }
  const folder=input.path??session.rootPath,skip=input.skip??0,limit=input.limit??200
  if(!targetPathWithin(folder,session.rootPath,session.pathSeparator))throw new VbrRecoveryError('Choose a folder within the selected destination.',400)
  const page=nativePage.parse(await ctx.send(path+'/browse',{method:'POST',body:{path:folder,order:{orderColumn:'Type',orderAsc:true},
    filter:{itemTypes:['Drive','Folder']},pagination:{skip,limit}}}))
  if(page.path!==folder||page.items.length>limit||page.pagination?.skip!==undefined&&page.pagination.skip!==skip)throw denied()
  const items:TargetFolder[]=[]
  for(const item of page.items){
    if(item.itemType!=='Drive'&&item.itemType!=='Folder')continue
    const fullName=targetFolderPath(item,session.pathSeparator)
    if(!fullName||fullName===folder||!targetPathWithin(fullName,session.rootPath,session.pathSeparator)||!targetPathWithin(fullName,folder,session.pathSeparator))continue
    items.push({name:item.name,path:fullName,type:item.itemType,isSymbolicLink:!!item.isSymbolicLink})
  }
  return {path:page.path,items,total:page.pagination?.total??null,count:page.items.length,skip}
}
