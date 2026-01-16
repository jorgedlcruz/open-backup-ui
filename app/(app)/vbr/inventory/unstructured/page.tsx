"use client"

import { UnstructuredDataTable } from "@/components/unstructured-data-table"

export default function UnstructuredDataPage() {
    return (
        <div className="container mx-auto py-8 px-4 space-y-8">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Unstructured Data</h2>
                <p className="text-muted-foreground">
                    Manage unstructured data servers (File Shares, Object Storage, etc.).
                </p>
            </div>

            <UnstructuredDataTable />
        </div>
    )
}
