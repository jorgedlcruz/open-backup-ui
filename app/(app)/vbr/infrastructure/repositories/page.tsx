import { RepositoryList } from "@/components/repositories/repository-list"

export const metadata = {
    title: "Backup Repositories",
    description: "Manage your backup repositories and capacity.",
}

export default function BackupRepositoriesPage() {
    return <RepositoryList />
}
