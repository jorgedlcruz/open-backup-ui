// Open Backup UI v1.0.2
import { NextRequest } from 'next/server'
import { readLicensing } from '@/lib/server/licensing'
export const dynamic='force-dynamic'
export function GET(request:NextRequest) {return readLicensing(request,'vbr')}
