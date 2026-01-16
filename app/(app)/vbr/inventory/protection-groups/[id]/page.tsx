"use client"

import { DiscoveredEntitiesTable } from "@/components/discovered-entities-table"

import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export default function DiscoveredEntitiesPage() {
    // We could fetch the protection group details to show the name in the title,
    // but for now, we'll just show "Discovered Entities".
    // Alternatively, the table component already fetches data, we could lift state or just fetch details here.

    return (
        <div className="container mx-auto py-8 px-4 space-y-8">
            <div>
                <Button variant="ghost" asChild className="mb-4 pl-0 hover:pl-2 transition-all">
                    <Link href="/vbr/inventory/protection-groups">
                        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Protection Groups
                    </Link>
                </Button>
                <h2 className="text-3xl font-bold tracking-tight">Discovered Entities</h2>
                <p className="text-muted-foreground">
                    Manage computers and agents within this protection group.
                </p>
            </div>

            <DiscoveredEntitiesTable />
        </div>
    )
}
