import { notFound } from 'next/navigation'
import { UnstructuredOperations } from '@/components/unstructured-data/unstructured-operations'
import { validId } from '@/lib/investigation/model'

export const metadata = { title: 'Unstructured source investigation | Open Backup UI' }
export default async function SourcePage({params}:{params:Promise<{id:string}>}) {
  const {id}=await params
  if(!validId(id))notFound()
  return <UnstructuredOperations id={id.toLowerCase()}/>
}
