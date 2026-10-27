import { WorkloadResilience } from '@/components/resilience/workload-resilience'
export default async function WorkloadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <WorkloadResilience id={id} />
}
