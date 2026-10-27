import {cookies} from 'next/headers'
import {redirect} from 'next/navigation'
import {lensCookie,lensHref} from '@/lib/lens/navigation'
export const dynamic='force-dynamic'
export default async function ProtectionLensPage(){redirect(lensHref((await cookies()).get(lensCookie)?.value))}
