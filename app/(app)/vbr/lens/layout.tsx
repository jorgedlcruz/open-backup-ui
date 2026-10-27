import {cookies} from 'next/headers'
import {LensPreferences} from '@/components/lens/lens-preferences'
import {defaultLens,lensCookie} from '@/lib/lens/navigation'
export default async function LensLayout({children}:{children:React.ReactNode}){
  return <LensPreferences initialDefault={defaultLens((await cookies()).get(lensCookie)?.value)}>{children}</LensPreferences>
}
