"use client"

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { JobInvestigationPage } from '@/components/investigation/job-investigation'

export default function JobDetailsPage() {
  const { id } = useParams<{ id: string }>()
  return <Suspense fallback={<div className="p-8">Loading job investigation…</div>}><JobInvestigationPage key={id} id={id.toLowerCase()} /></Suspense>
}
