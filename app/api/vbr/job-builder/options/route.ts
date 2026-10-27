import { NextRequest } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadOptions } from '@/lib/job-builder/load'
export const dynamic='force-dynamic'
export async function GET(request:NextRequest) {return withVbrRead(request,(read,name,browse,context)=>loadOptions(read,browse,name,context.sourceKey))}
