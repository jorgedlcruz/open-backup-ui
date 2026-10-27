import { notFound } from 'next/navigation'
import { ProxyOperations } from '@/components/proxies/proxy-operations'
import { validId } from '@/lib/investigation/model'

export const metadata = { title: 'Proxy Investigation' }
export default async function ProxyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!validId(id)) notFound()
  return <ProxyOperations id={id.toLowerCase()} />
}
