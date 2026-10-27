import type { Metadata } from 'next'
import { Suspense } from 'react'
import { JobInvestigation } from '@/components/vbm-jobs/job-investigation'
export const dynamic='force-dynamic'
export const metadata:Metadata={title:'Microsoft 365 Job Investigation | Operations'}
export default function Page() {return <Suspense fallback={<div className="p-8">Loading job investigation…</div>}><JobInvestigation/></Suspense>}
