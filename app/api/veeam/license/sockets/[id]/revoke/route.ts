import { NextRequest } from 'next/server'
import { mutateLicensing } from '@/lib/server/licensing'
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}) {const {id}=await params;return mutateLicensing(request,'vbr','revoke',{kind:'sockets',id})}
