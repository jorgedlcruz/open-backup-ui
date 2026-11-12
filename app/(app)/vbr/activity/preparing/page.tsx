// Open Backup UI v1.2.0
import { PreparingRecovery } from '@/components/restore-points/preparing-recovery'

export default async function PreparingPage({ searchParams }: { searchParams: Promise<{ request?: string;sourceKey?:string;provider?:string }> }) {
  const { request,sourceKey,provider } = await searchParams
  return <PreparingRecovery requestId={request || ''} sourceKey={sourceKey} provider={provider} />
}
