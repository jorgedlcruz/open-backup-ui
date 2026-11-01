import { cookies } from 'next/headers'
import { LABS_COOKIE } from '@/lib/labs/model'
import { LabsCanvas } from '@/components/labs/labs-canvas'
import { LabsSettings } from '@/components/labs/labs-settings'

export default async function LabsPage() {
  const jar = await cookies()
  if (jar.get(LABS_COOKIE)?.value !== 'true') return <LabsSettings />
  return <LabsCanvas key={jar.get('veeam_source_id')?.value ?? 'environment'} sourceScope={jar.get('veeam_source_id')?.value ?? 'environment'} />
}
