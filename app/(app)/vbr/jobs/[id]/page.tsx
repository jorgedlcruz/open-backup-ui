"use client"
// Open Backup UI v1.2.0

import { Trans } from '@/components/providers/i18n-provider'
import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { JobInvestigationPage } from '@/components/investigation/job-investigation'

export default function JobDetailsPage() {
  const { id } = useParams<{ id: string }>()
  return <Suspense fallback={<div className="p-8"><Trans>Loading job investigation…</Trans></div>}><JobInvestigationPage key={id} id={id.toLowerCase()} /></Suspense>
}
