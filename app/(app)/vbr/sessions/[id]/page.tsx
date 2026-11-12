"use client"
// Open Backup UI v1.2.0

import { useParams } from 'next/navigation'
import { SessionPage } from '@/components/investigation/session-investigation'

export default function SessionDetailsPage() {
  const { id } = useParams<{ id: string }>()
  return <SessionPage key={id} id={id.toLowerCase()} />
}
