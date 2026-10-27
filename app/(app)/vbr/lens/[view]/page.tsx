import {notFound} from 'next/navigation'
import {OperationsConsole} from '@/components/operations/operations-console'
import {isLensId,lenses} from '@/lib/lens/navigation'
import type {JobFilter} from '@/lib/operations/model'
import {ForecastConsole} from '@/components/forecast/forecast-console'
export async function generateMetadata({params}:{params:Promise<{view:string}>}){
  const {view}=await params,lens=lenses.find(item=>item.id===view)
  return {title:lens?`${lens.title} · Protection Lens`:'Protection Lens'}
}
export default async function LensPage({params,searchParams}:{params:Promise<{view:string}>;searchParams:Promise<{filter?:string}>}){
  const {view}=await params
  if(!isLensId(view))notFound()
  if(view==='forecast')return <ForecastConsole/>
  const {filter}=await searchParams,valid=['attention','running','failed','warning','disabled','all'].includes(filter||'')
  return <OperationsConsole view={view} initialFilter={valid?filter as JobFilter:'attention'}/>
}
