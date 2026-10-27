import { NextRequest } from 'next/server'
import { mutateSource } from '@/lib/server/data-sources'
export const dynamic='force-dynamic'
type Context={params:Promise<{id:string}>}
export async function PATCH(request:NextRequest,{params}:Context){return mutateSource(request,'edit',(await params).id)}
export async function DELETE(request:NextRequest,{params}:Context){return mutateSource(request,'remove',(await params).id)}
