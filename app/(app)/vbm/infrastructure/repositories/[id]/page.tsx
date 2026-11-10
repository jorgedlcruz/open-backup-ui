// Open Backup UI v1.2.0
import { RepositoryInvestigation } from '@/components/vbm-repositories/repository-investigation'
import { getRequestI18n } from '@/lib/i18n/server'
export const dynamic='force-dynamic'
export async function generateMetadata() {const {t}=await getRequestI18n();return {title:`${t('Repository investigation')} | Microsoft 365`}}
export default async function Page({params}:{params:Promise<{id:string}>}) {const {id}=await params;return <RepositoryInvestigation key={id} id={id}/>}
