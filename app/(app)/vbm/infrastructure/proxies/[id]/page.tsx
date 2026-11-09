// Open Backup UI v1.0.2
import { ProxyInvestigation } from '@/components/vbm-proxies/proxy-investigation'
import { getRequestI18n } from '@/lib/i18n/server'
export async function generateMetadata() {const {t}=await getRequestI18n();return {title:`${t('Proxy investigation')} | Microsoft 365`}}
export default async function Page({params}:{params:Promise<{id:string}>}) {const {id}=await params;return <ProxyInvestigation id={id}/>}
