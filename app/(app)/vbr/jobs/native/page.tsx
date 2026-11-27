// Open Backup UI v1.3.0
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { NativeJobEditor } from '@/components/job-builder/native-job-editor'
import { supportedJob } from '@/lib/job-builder/native-job-types'

export default async function NativeJobPage({searchParams}:{searchParams:Promise<{type?:string;id?:string}>}){
  const {type,id}=await searchParams
  if(!supportedJob(type) || (id!==undefined&&!z.string().uuid().safeParse(id).success))notFound()
  return <NativeJobEditor key={type+'/'+(id||'new')} type={type} jobId={id}/>
}
