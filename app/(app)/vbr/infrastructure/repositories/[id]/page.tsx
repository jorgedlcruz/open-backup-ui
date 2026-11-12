"use client"
// Open Backup UI v1.2.0

import { useParams } from 'next/navigation'
import { RepositoryInvestigation } from '@/components/repositories/repository-investigation'

export default function RepositoryDetailsPage() {
  const { id } = useParams<{ id: string }>()
  return <RepositoryInvestigation key={id} id={id.toLowerCase()} />
}
