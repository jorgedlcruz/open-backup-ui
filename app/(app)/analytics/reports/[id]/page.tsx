// Open Backup UI v1.2.0
import { ReportWorkspace } from '@/components/one-reports/report-workspace'
export default async function ReportPage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <ReportWorkspace id={id}/>}
