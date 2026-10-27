import { Suspense } from 'react'
import { RestorePoints } from '@/components/vbm-protected/restore-points'
import { Loading } from '@/components/investigation/shared'
export default function Page() {return <Suspense fallback={<Loading/>}><RestorePoints/></Suspense>}
