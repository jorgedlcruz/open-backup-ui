// Open Backup UI v1.0.2
import {RecoveryCenterWorkspace} from '@/components/recovery-center/recovery-center-workspace'
import {getRequestI18n} from '@/lib/i18n/server'

export async function generateMetadata() {
  const {t}=await getRequestI18n()
  return {title:t('Recovery Center')+' | Open Backup UI'}
}
export default async function RecoveryCenterPage({searchParams}:{searchParams:Promise<{name?:string}>}) {
  const {name}=await searchParams
  return <RecoveryCenterWorkspace initialSearch={typeof name==='string'?name.slice(0,256):''}/>
}
