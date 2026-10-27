import type { Metadata } from 'next'
import { JobsConsole } from '@/components/vbm-jobs/jobs-console'
export const dynamic='force-dynamic'
export const metadata:Metadata={title:'Microsoft 365 Backup Jobs | Operations'}
export default async function Page({searchParams}:{searchParams:Promise<{organizationId?:string;repositoryId?:string}>}) {const params=await searchParams,organizationId=typeof params.organizationId==='string' ? params.organizationId:'',repositoryId=typeof params.repositoryId==='string' ? params.repositoryId:'';return <JobsConsole key={`${organizationId}:${repositoryId}`} organizationId={organizationId} repositoryId={repositoryId}/>}
