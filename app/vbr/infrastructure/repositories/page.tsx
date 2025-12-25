import { BackupRepositoriesTable } from "@/components/backup-repositories-table"

export const metadata = {
    title: "Backup Repositories",
    description: "Manage your backup repositories and capacity.",
}

export default function BackupRepositoriesPage() {
    return (
        <div className="container mx-auto py-8 px-4 space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Backup Repositories</h1>
                    <p className="text-muted-foreground">
                        Manage your backup storage locations, capacity, and performance tiers.
                    </p>
                </div>
            </div>
            <BackupRepositoriesTable />
        </div>
    )
}
