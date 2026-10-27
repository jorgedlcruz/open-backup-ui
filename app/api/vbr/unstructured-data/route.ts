import { NextRequest } from 'next/server'
import { withVbrRead } from '@/lib/server/vbr-read'
import { loadUnstructured } from '@/lib/unstructured-data/load'

export const dynamic='force-dynamic'
export async function GET(request:NextRequest) {
  return withVbrRead(request,(read,source)=>loadUnstructured(read,source))
}
