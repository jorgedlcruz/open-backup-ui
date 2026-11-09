import { PreparingRecovery } from '@/components/restore-points/preparing-recovery'

export default async function PreparingPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const { request } = await searchParams
  return <PreparingRecovery requestId={request || ''} />
}
