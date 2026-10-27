import { ProxyInvestigation } from '@/components/vbm-proxies/proxy-investigation'
export default async function Page({params}:{params:Promise<{id:string}>}) {const {id}=await params;return <ProxyInvestigation id={id}/>}
