// Open Backup UI v1.0.2
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PublicKiosk } from '@/components/labs/public-kiosk'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Shared kiosk | Open Backup UI', robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' }
export default async function SharedKioskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) notFound()
  return <PublicKiosk id={id} />
}
