// Open Backup UI v1.0.2
import {notFound} from 'next/navigation'
import {OperationsConsole} from '@/components/operations/operations-console'
import {isLensId,lenses} from '@/lib/lens/navigation'
import type {JobFilter} from '@/lib/operations/model'
import {ForecastConsole} from '@/components/forecast/forecast-console'
import {getRequestI18n} from '@/lib/i18n/server'
export async function generateMetadata({params}:{params:Promise<{view:string}>}){
  const {view}=await params,lens=lenses.find(item=>item.id===view)
  const {t}=await getRequestI18n()
  return {title:lens?`${t(lens.title)} · Protection Lens`:'Protection Lens'}
}
export default async function LensPage({params,searchParams}:{params:Promise<{view:string}>;searchParams:Promise<{filter?:string;repository?:string;mode?:string}>}){
  const {view}=await params
  if(!isLensId(view))notFound()
  if(view==='forecast'){
    const {repository,mode}=await searchParams
    return <ForecastConsole initialRepository={typeof repository==='string'?repository:''} initialMode={mode==='capacity'?'capacity':'files'}/>
  }
  const {filter}=await searchParams,valid=['attention','running','failed','warning','disabled','all'].includes(filter||'')
  return <OperationsConsole view={view} initialFilter={valid?filter as JobFilter:'attention'}/>
}
