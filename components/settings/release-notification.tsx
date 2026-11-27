'use client'
// Open Backup UI v1.3.0

import Link from 'next/link'
import { Bell } from 'lucide-react'
import { useI18n } from '@/components/providers/i18n-provider'
import { useReleaseStatus } from './use-release-status'

export function ReleaseNotification() {
  const status = useReleaseStatus(false)
  const { t } = useI18n()
  if (status?.state !== 'available' || !status.release) return null
  const label = `${t('Update available')} · ${status.release.tag}`
  return <Link href="/settings/updates" aria-label={label} title={label} className="relative inline-flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-2 text-xs font-medium hover:bg-accent">
    <Bell size={16} aria-hidden="true" /><span className="hidden sm:inline">{t('Update available')}</span>
    <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary sm:hidden" aria-hidden="true" />
  </Link>
}
