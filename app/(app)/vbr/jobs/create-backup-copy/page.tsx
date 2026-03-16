import { CreateBackupCopyWizard } from "./_components/create-backup-copy-wizard"

export default function CreateBackupCopyJobPage() {
    return (
        <div className="flex-1 overflow-auto">
            <div className="container max-w-4xl mx-auto py-8 px-4">
                <div className="mb-6">
                    <h1 className="text-3xl font-bold tracking-tight">Create Backup Copy Job</h1>
                    <p className="text-muted-foreground mt-2">
                        Configure a new Backup Copy job to replicate existing backups to another repository.
                    </p>
                </div>

                <CreateBackupCopyWizard />
            </div>
        </div>
    )
}
