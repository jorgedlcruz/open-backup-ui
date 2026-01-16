"use client"

import { ProtectionGroupsTable } from "./_components/protection-groups-table"

export default function ProtectionGroupsPage() {
    return (
        <div className="container mx-auto py-8 px-4 space-y-8">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Physical & Cloud Infrastructure</h2>
                <p className="text-muted-foreground">
                    Manage protection groups and discovered computers.
                </p>
            </div>

            <ProtectionGroupsTable />
        </div>
    )
}
