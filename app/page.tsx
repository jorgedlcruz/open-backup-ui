import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getChunkedCookie } from '@/lib/utils/cookie-manager'

// Check if user has configured data sources and valid sessions
// If yes, redirect to dashboard
// If no, show landing page
export default async function Home() {
  const cookieStore = await cookies()

  // Check for any valid auth tokens
  const vbrToken = getChunkedCookie(cookieStore, 'veeam_vbr_token')
  const vb365Token = getChunkedCookie(cookieStore, 'veeam_vb365_token')
  const vroToken = getChunkedCookie(cookieStore, 'veeam_vro_token')
  const voneToken = getChunkedCookie(cookieStore, 'veeam_one_token')

  // Also check legacy .env configuration
  const hasEnvConfig = !!(
    process.env.VEEAM_API_URL ||
    process.env.VBM_API_URL ||
    process.env.VRO_API_URL ||
    process.env.VEEAM_ONE_API_URL
  )

  // If user has any authenticated session or .env config, go to dashboard
  if (vbrToken || vb365Token || vroToken || voneToken || hasEnvConfig) {
    redirect('/dashboard')
  }

  // Otherwise, redirect to landing page
  redirect('/connect')
}