"use client"

import { useParams } from 'next/navigation'
import { RepositoryInvestigation } from '@/components/repositories/repository-investigation'

export default function RepositoryDetailsPage() {
  const { id } = useParams<{ id: string }>()
  return <RepositoryInvestigation key={id} id={id.toLowerCase()} />
}
