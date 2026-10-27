import { NextRequest } from 'next/server'
import { readSources, mutateSource } from '@/lib/server/data-sources'
export const dynamic='force-dynamic'
export const GET=(request:NextRequest)=>readSources(request)
export const POST=(request:NextRequest)=>mutateSource(request,'add')
