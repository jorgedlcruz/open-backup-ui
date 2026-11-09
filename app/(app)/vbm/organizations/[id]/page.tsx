// Open Backup UI v1.0.2
import { OrganizationInvestigation } from '@/components/vbm-organizations/organization-investigation'
import { getRequestI18n } from '@/lib/i18n/server'
export const dynamic='force-dynamic'
export async function generateMetadata() {const {t}=await getRequestI18n();return {title:`${t('Organization investigation')} | Microsoft 365`}}
export default async function Page({params}:{params:Promise<{id:string}>}) {const {id}=await params;return <OrganizationInvestigation key={id} id={id}/>}
