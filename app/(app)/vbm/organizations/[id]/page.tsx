import { OrganizationInvestigation } from '@/components/vbm-organizations/organization-investigation'
export const dynamic='force-dynamic'
export default async function Page({params}:{params:Promise<{id:string}>}) {const {id}=await params;return <OrganizationInvestigation key={id} id={id}/>}
