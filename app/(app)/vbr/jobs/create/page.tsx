import { CreateJobWizard } from "./_components/create-job-wizard"

export default async function CreateJobPage(props: { searchParams: Promise<{ platform?: string }> }) {
    const searchParams = await props.searchParams;
    const platform = searchParams?.platform || 'vmware'

    return (
        <div className="flex-1 overflow-auto">
            <div className="container max-w-4xl mx-auto py-8 px-4">
                <div className="mb-6">
                    <h1 className="text-3xl font-bold tracking-tight">Create Backup Job</h1>
                    <p className="text-muted-foreground mt-2">
                        Configure a new {platform === 'hyperv' ? 'Microsoft Hyper-V' : 'VMware vSphere'} backup job
                    </p>
                </div>

                <CreateJobWizard />
            </div>
        </div>
    )
}
