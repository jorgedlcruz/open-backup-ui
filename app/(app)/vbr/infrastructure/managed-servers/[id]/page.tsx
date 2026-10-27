import { notFound } from 'next/navigation'
import { ServerOperations } from '@/components/managed-servers/server-operations'
import { validId } from '@/lib/investigation/model'

export const metadata = { title: 'Managed Server Investigation' }
export default async function ManagedServerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!validId(id)) notFound()
  return <ServerOperations id={id.toLowerCase()} />
}
