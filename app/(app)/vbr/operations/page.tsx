import {redirect} from 'next/navigation'
import {legacyLensTarget} from '@/lib/lens/navigation'
export default async function LegacyLensPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  redirect(legacyLensTarget('operations',await searchParams))
}