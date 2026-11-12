"use client"
// Open Backup UI v1.2.0
import { useI18n } from '@/components/providers/i18n-provider'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { RestorePointExplorer } from '@/components/restore-points/restore-point-explorer'

export const dynamic = 'force-dynamic'
function RestorePointsContent() {
  const params = useSearchParams();
  return <RestorePointExplorer objectId={params.get('objectId') || undefined} backupId={params.get('backupId') || undefined} name={params.get('name') || undefined} />;
}
export default function RestorePointsPage() {
  const { t } = useI18n()
  return <Suspense fallback={<div className="p-8 text-muted-foreground">{t("Loading recovery points…")}</div>}><RestorePointsContent /></Suspense>;
}
