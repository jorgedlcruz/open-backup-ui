import { JobBuilder } from '@/components/job-builder/job-builder'

export default async function CreateJobPage(props: { searchParams: Promise<{ platform?: string }> }) {
    const searchParams = await props.searchParams;
    const platform = searchParams?.platform || 'vmware'

    return (
        <div className="flex-1 overflow-auto"><JobBuilder platform={platform==='hyperv'?'HyperV':'VSphere'}/></div>
    )
}
