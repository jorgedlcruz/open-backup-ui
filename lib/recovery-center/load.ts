// Open Backup UI v1.0.2
import {z} from 'zod'
import {loadActivityMounts} from '../activity/load'
import {investigationSessionSchema,type Mount} from '../activity/model'
import {isRecoverySession,recoverySessionTypes} from './model'
import {TopologyRequestError} from '../topology/load'
import type {PublishedRecoveryReader,VbrReader} from '../server/vbr-read'

const pageSize=500
const mode=z.enum(['public','legacy','private'])
export const recoveryPageQuery=z.object({skip:z.coerce.number().int().min(0).max(2147483647).default(0),
  before:z.iso.datetime({offset:true}).optional(),mode:mode.optional(),sourceKey:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict()
  .refine(v=>!v.skip||Boolean(v.before&&v.sourceKey&&v.mode))
type Query=z.infer<typeof recoveryPageQuery>
const response=z.object({data:z.array(z.unknown()),pagination:z.object({skip:z.number().int().optional(),total:z.number().int().nonnegative().optional()}).optional()})
const minimal=investigationSessionSchema.pick({id:true,name:true,sessionType:true,creationTime:true,endTime:true,state:true,result:true,
  progressPercent:true,progress:true,initiatedBy:true,platformName:true,resourceReference:true,resourceId:true,
  jobId:true,originalSessionId:true,parentSessionId:true,relatedSessionId:true})
async function readPage(read:VbrReader,query:Query,before:string) {
  let last:unknown
  for(const method of query.mode?[query.mode]:['public','private','legacy'] as const) {
    const params=new URLSearchParams({orderColumn:'CreationTime',orderAsc:'false',createdBeforeFilter:before,skip:String(query.skip),limit:String(pageSize)})
    if(method!=='legacy')for(const type of recoverySessionTypes)params.append('typeFilter',type)
    let page:z.infer<typeof response>
    try{page=response.parse(await read((method==='private'?'/private-api':'/api')+'/v1/sessions?'+params,method==='legacy'?'1.3-rev1':'1.3-rev2'))}
    catch(error){last=error;if(error instanceof TopologyRequestError&&error.status===401)throw error;continue}
    if(page.pagination?.skip!=null&&page.pagination.skip!==query.skip)throw new TopologyRequestError('Session history unavailable',502)
    let malformed=false
    const history=page.data.flatMap(raw=>{
      const row=minimal.safeParse(raw)
      if(!row.success){malformed=true;return []}
      const session=row.data
      if(!isRecoverySession(session))return []
      const {progress,result,...rest}=session
      return [{...rest,result:result?{result:result.result,isCanceled:result.isCanceled}:null,progressPercent:session.progressPercent??progress?.progressPercent}]
    })
    const next=query.skip+page.data.length
    const more=page.pagination?.total==null?page.data.length===pageSize:next<page.pagination.total
    return {history,nextSkip:more&&page.data.length?next:null,mode:method,malformed:malformed||more&&!page.data.length}
  }
  throw last??new TopologyRequestError('Session history unavailable',502)
}

export async function loadRecoverySnapshot(read:VbrReader,published?:PublishedRecoveryReader,query:Query={skip:0},now=new Date()) {
  const before=query.before||now.toISOString()
  let privateMountsUnavailable=false
  const crossPlatform:PublishedRecoveryReader|undefined=published?async(skip,limit)=>{
    try{return await published(skip,limit)}catch(error){privateMountsUnavailable=true;throw error}
  }:undefined
  const [history,mounted]=await Promise.allSettled([readPage(read,query,before),query.skip
    ? Promise.resolve({mounts:[] as Mount[],warnings:[] as string[],available:false}) : loadActivityMounts(read,crossPlatform)])
  if(history.status==='rejected'&&(query.skip||mounted.status==='rejected'||!mounted.value.available))throw history.reason
  const result=history.status==='fulfilled'?history.value:null
  const warnings=mounted.status==='fulfilled'?[...mounted.value.warnings]:['Mounted recoveries']
  if(privateMountsUnavailable&&!warnings.includes('Mounted recoveries'))warnings.push('Mounted recoveries')
  if(!result||result.malformed)warnings.push('Session history')
  // Keep detailed publication, network and mount configuration on the verified detail view.
  const mounts=mounted.status==='fulfilled'?mounted.value.mounts.map(({id,sessionId,kind,operation,state,name,backup,error})=>({id,sessionId,kind,operation,state,name,backup,error:error?'Mount failed':undefined})):[]
  return {before,history:result?.history??[],nextSkip:result?.nextSkip??null,mode:result?.mode??'public' as const,mounts,warnings}
}
