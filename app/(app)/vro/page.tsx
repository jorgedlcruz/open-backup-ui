"use client"

export const dynamic = 'force-dynamic'

import { useState, useEffect } from "react"
import { RecoveryPlansTable } from "@/components/recovery-plans-table"
import { veeamApi } from "@/lib/api/veeam-client"
import { VRORecoveryPlan } from "@/lib/types/veeam"

export default function VROPage() {
  const [plans, setPlans] = useState<VRORecoveryPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // const { searchQuery } = useSearch() // Global search removed

  useEffect(() => {
    const fetchPlans = async () => {
      try {
        setLoading(true)
        setError(null)
        const data = await veeamApi.getRecoveryPlans()
        setPlans(data)
      } catch (err) {
        console.error('Failed to fetch recovery plans:', err)
        setError(err instanceof Error ? err.message : 'Failed to fetch recovery plans')
      } finally {
        setLoading(false)
      }
    }

    fetchPlans()

    // Refresh data every 30 seconds
    const interval = setInterval(fetchPlans, 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex-1 overflow-auto">
      <div className="container mx-auto py-8 px-4">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Veeam Recovery Orchestrator</h1>
          <p className="text-muted-foreground mt-2">
            Monitor and manage your recovery orchestration plans
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800 font-medium">Error: {error}</p>
            <p className="text-red-600 text-sm mt-1">
              Please check your VRO API configuration and credentials
            </p>
          </div>
        )}

        <RecoveryPlansTable data={plans} loading={loading} />
      </div>
    </div>
  )
}
