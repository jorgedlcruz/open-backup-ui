// Open Backup UI v1.0.2
import {notFound} from 'next/navigation'
import {RecoveryGroup} from '@/components/recovery-center/recovery-group'
import {getRequestI18n} from '@/lib/i18n/server'
import {validId} from '@/lib/investigation/model'

export async function generateMetadata() {
  const {t}=await getRequestI18n()
  return {title:t('VM recovery group')+' · '+t('Recovery Center')+' | Open Backup UI'}
}

export default async function Page({params,searchParams}:{
  params:Promise<{id:string}>;searchParams:Promise<{sourceKey?:string|string[]}>
}) {
  const {id}=await params,{sourceKey}=await searchParams
  if(!validId(id)||typeof sourceKey!=='string'||!/^[a-f0-9]{64}$/i.test(sourceKey))notFound()
  return <RecoveryGroup key={sourceKey+id} id={id.toLowerCase()} sourceKey={sourceKey.toLowerCase()}/>
}
