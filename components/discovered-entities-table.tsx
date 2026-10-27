"use client"

import { useParams } from 'next/navigation'
import { ProtectionOperations } from '@/components/protection-groups/protection-operations'
import { validId } from '@/lib/investigation/model'

export function DiscoveredEntitiesTable() {
  const { id } = useParams<{ id: string }>()
  return validId(id) ? <ProtectionOperations key={id.toLowerCase()} id={id.toLowerCase()} /> : null
}
