// Open Backup UI v1.0.2
import { CreateEntraIdWizard, CreateEntraIdHeading } from "./_components/create-entraid-wizard"

export default async function CreateEntraIdJobPage(props: { searchParams: Promise<{ type?: string }> }) {
    const searchParams = await props.searchParams;
    const type = searchParams?.type || 'tenant'

    return (
        <div className="flex-1 overflow-auto">
            <div className="container max-w-4xl mx-auto py-8 px-4">
                <div className="mb-6">
                    <CreateEntraIdHeading type={type} />
                </div>

                <CreateEntraIdWizard />
            </div>
        </div>
    )
}
