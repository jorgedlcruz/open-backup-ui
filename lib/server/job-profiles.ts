import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { profileInput,profileSchema,type Profile } from '../job-builder/model'
import { withFileLease } from './file-lease'
import { TopologyRequestError } from '../topology/load'

const storeSchema=z.object({version:z.literal(1),sources:z.record(z.string(),z.array(profileSchema).max(200))}).strict()
export class JobProfileStore {
  constructor(private file=path.join(process.cwd(),'data','job-profiles.json')){}
  private async read() {
    try{return storeSchema.parse(JSON.parse(await fs.readFile(this.file,'utf8')))}
    catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {version:1 as const,sources:{} as Record<string,Profile[]>};throw e}
  }
  async list(sourceKey:string):Promise<Profile[]> {return (await this.read()).sources[sourceKey]||[]}
  async save(sourceKey:string,input:unknown,id?:string,expectedRevision?:number) {
    const value=profileInput.parse(input)
    const result=await withFileLease(this.file+'.lock',15000,async()=>{
      const data=await this.read(),profiles=data.sources[sourceKey]||[],old=profiles.find(p=>p.id===id)
      if(id&&(!old||old.revision!==expectedRevision))throw new TopologyRequestError('This profile changed or was removed. Reload the library before saving.',409)
      if(old&&old.kind!==value.kind)throw new TopologyRequestError('A profile’s category cannot be changed.',400)
      if(profiles.some(p=>p.id!==id&&p.kind===value.kind&&p.name.toLowerCase()===value.name.toLowerCase()))throw new TopologyRequestError('A profile with this name already exists in this category.',409)
      if(!old&&profiles.length>=200)throw new TopologyRequestError('This source already has 200 profiles.',400)
      const profile:Profile={...value,id:old?.id||randomUUID(),revision:(old?.revision||0)+1,updatedAt:new Date().toISOString()}
      data.sources[sourceKey]=[...profiles.filter(p=>p.id!==profile.id),profile]
      const temp=this.file+'.'+randomUUID()+'.tmp'
      try{await fs.writeFile(temp,JSON.stringify(data,null,2),{mode:0o600});await fs.rename(temp,this.file)}finally{await fs.unlink(temp).catch(()=>{})}
      return profile
    })
    if(!result)throw new TopologyRequestError('The profile library is busy. Try saving again.',409)
    return result
  }
}
export const jobProfiles=new JobProfileStore()
