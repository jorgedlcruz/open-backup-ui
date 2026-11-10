// Open Backup UI v1.2.0
import { IdentityConsole } from '@/components/identity/identity-console'

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const { role } = await searchParams
  return <IdentityConsole key="users" mode="users" initialRole={role || 'all'} />
}
