import { RepositoryInvestigation } from '@/components/vbm-repositories/repository-investigation'
export const dynamic='force-dynamic'
export const metadata={title:'Microsoft 365 Repository Investigation | Operations'}
export default async function Page({params}:{params:Promise<{id:string}>}) {const {id}=await params;return <RepositoryInvestigation key={id} id={id}/>}
