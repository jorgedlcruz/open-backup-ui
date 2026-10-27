"use client"

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { RestorePointExplorer } from '@/components/restore-points/restore-point-explorer'

export const dynamic = 'force-dynamic'
function RestorePointsContent() {
  const params = useSearchParams();
  return <RestorePointExplorer objectId={params.get('objectId') || undefined} backupId={params.get('backupId') || undefined} name={params.get('name') || undefined} />;
}
export default function RestorePointsPage() {
  return <Suspense fallback={<div className="p-8 text-muted-foreground">Loading recovery points…</div>}><RestorePointsContent /></Suspense>;
}
