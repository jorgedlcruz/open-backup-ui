import { AlarmsConsole } from '@/components/one-alarms/alarms-console'
import { emptyFilters, filtersSchema } from '@/lib/one-alarms/model'
export const dynamic = 'force-dynamic'
export default async function AlarmsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params=await searchParams,value:Record<string,unknown>={}
  for(const key of Object.keys(emptyFilters)) {const raw=params[key==='query' ? 'search':key==='statuses' ? 'status':key];if(typeof raw==='string')value[key]=key==='statuses' ? raw==='All' ? []:raw.split(','):raw}
  const parsed=filtersSchema.safeParse(value)
  return <AlarmsConsole initialFilters={parsed.success ? parsed.data:emptyFilters}/>
}
