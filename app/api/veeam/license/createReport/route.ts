import { NextRequest } from 'next/server'
import { mutateLicensing } from '@/lib/server/licensing'
export const dynamic='force-dynamic'
export function POST(request:NextRequest) {return mutateLicensing(request,'vbr','report',{})}
