"use client"

import { VirtualInfrastructureTable } from "@/components/virtual-infrastructure-table"

export default function VirtualInfrastructurePage() {
    return (
        <div className="container mx-auto py-8 px-4 space-y-8">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Virtual Infrastructure</h2>
                <p className="text-muted-foreground">
                    View and manage your virtual infrastructure inventory (VMs, Hosts, Datacenters).
                </p>
            </div>

            <VirtualInfrastructureTable />
        </div>
    )
}
