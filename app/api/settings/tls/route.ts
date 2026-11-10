// Open Backup UI v1.2.0
import { NextRequest, NextResponse } from 'next/server'
import { boundedHttpsJson, httpsControl, HttpsSettingsError, validateHttpsMutation } from '@/lib/server/tls-settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store' }
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof HttpsSettingsError ? error.message : 'HTTPS settings could not be processed.' }, { status: error instanceof HttpsSettingsError ? error.status : 500, headers })
}

export async function GET() {
  try { return NextResponse.json(await httpsControl('GET'), { headers }) }
  catch (error) { return failure(error) }
}

export async function POST(request: NextRequest) {
  try {
    const hostname = validateHttpsMutation(request)
    const input = await boundedHttpsJson(request)
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpsSettingsError('A certificate and private key are required.')
    const bundle = input as Record<string, unknown>
    if (Object.keys(bundle).some(key => !['certificatePem', 'privateKeyPem', 'chainPem'].includes(key))) throw new HttpsSettingsError('Unexpected certificate upload fields.')
    return NextResponse.json(await httpsControl('POST', { bundle, hostname }), { headers })
  } catch (error) { return failure(error) }
}
