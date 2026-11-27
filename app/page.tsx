// Open Backup UI v1.3.0
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { workspaceConnections } from '@/lib/data-sources/model'

// Check if user has configured data sources and valid sessions
// If yes, redirect to dashboard
// If no, show landing page
export default async function Home() {
  const connections = workspaceConnections(await cookies(), process.env)
  if (Object.values(connections).some(Boolean)) {
    redirect('/dashboard')
  }

  // Otherwise, redirect to landing page
  redirect('/connect')
}
