import { NextRequest } from 'next/server'
import { mutateLicensing } from '@/lib/server/licensing'
export async function DELETE(request:NextRequest,{params}:{params:Promise<{id:string}>}) {const {id}=await params;return mutateLicensing(request,'vbm','revoke',{kind:'user',id})}
