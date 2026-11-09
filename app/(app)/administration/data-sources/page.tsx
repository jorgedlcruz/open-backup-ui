import { SourcesConsole } from '@/components/data-sources/sources-console'
import { vmwareAdminEnabled } from '@/lib/server/vmware-console-admin'
export const dynamic = 'force-dynamic'
export default function DataSourcesPage() { return <SourcesConsole vmwareAdminEnabled={vmwareAdminEnabled()}/> }
