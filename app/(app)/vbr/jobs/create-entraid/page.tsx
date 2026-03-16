import { CreateEntraIdWizard } from "./_components/create-entraid-wizard"

export default async function CreateEntraIdJobPage(props: { searchParams: Promise<{ type?: string }> }) {
    const searchParams = await props.searchParams;
    const type = searchParams?.type || 'tenant'

    return (
        <div className="flex-1 overflow-auto">
            <div className="container max-w-4xl mx-auto py-8 px-4">
                <div className="mb-6">
                    <h1 className="text-3xl font-bold tracking-tight">Create Backup Job</h1>
                    <p className="text-muted-foreground mt-2">
                        Configure a new Microsoft Entra ID {type === 'audit' ? 'Audit Log' : 'Tenant'} backup job
                    </p>
                </div>

                <CreateEntraIdWizard />
            </div>
        </div>
    )
}
