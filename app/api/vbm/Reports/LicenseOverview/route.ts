import { NextRequest } from 'next/server'
import { mutateLicensing } from '@/lib/server/licensing'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest) {return mutateLicensing(request,'vbm','report',await request.json().catch(()=>null))}
