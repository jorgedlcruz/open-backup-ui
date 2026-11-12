// Open Backup UI v1.2.0
import { RecoverySignal } from '@/components/restore-points/recovery-signal'

export function DataLoading({status, compact}: {status?: string; compact?: boolean}) {
  return <div className="mx-auto w-full max-w-2xl"><RecoverySignal stage="data" status={status} compact={compact}/></div>
}
