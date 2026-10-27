import type { Metadata } from 'next'
import { RepositoryConsole } from '@/components/vbm-repositories/repository-console'
export const dynamic='force-dynamic'
export const metadata:Metadata={title:'Microsoft 365 Backup Repositories | Operations'}
export default function Page(){return <RepositoryConsole/>}
