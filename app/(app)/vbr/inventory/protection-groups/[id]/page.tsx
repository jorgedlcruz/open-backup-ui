import { notFound } from 'next/navigation'
import { ProtectionOperations } from '@/components/protection-groups/protection-operations'
import { validId } from '@/lib/investigation/model'

export const metadata = { title: 'Protection Group Investigation' }
export default async function ProtectionGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!validId(id)) notFound()
  return <ProtectionOperations key={id.toLowerCase()} id={id.toLowerCase()} />
}
