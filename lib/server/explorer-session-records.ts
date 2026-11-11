// Open Backup UI v1.2.0
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { replaceFile } from './atomic-file'

const ids=z.object({sourceKey:z.string().regex(/^[a-f0-9]{64}$/),principalKey:z.string().regex(/^[a-f0-9]{64}$/),sessionId:z.string().uuid()})
export type ExplorerKind='activeDirectory'|'sql'
const record=ids.extend({kind:z.enum(['activeDirectory','sql']),createdAt:z.string().datetime(),closedAt:z.string().datetime().optional(),restorePointId:z.string().uuid().optional()})
type Key=z.infer<typeof ids>
function file(key:Key) {
  const {sourceKey,principalKey,sessionId}=ids.parse(key)
  return path.join(process.cwd(),'data','application-browse',sourceKey,principalKey,sessionId.toLowerCase()+'.json')
}
export async function explorerSession(key:Key) {
  try {
    const row=record.parse(JSON.parse(await fs.readFile(file(key),'utf8')))
    if(row.sourceKey===key.sourceKey && row.principalKey===key.principalKey && row.sessionId===key.sessionId) return row
  } catch { /* Unknown sessions must not acquire a local browse capability. */ }
}
export async function rememberExplorerSession(key:Key,kind:ExplorerKind,closed:boolean,restorePointId?:string) {
  const target=file(key),old=await explorerSession(key),now=new Date().toISOString()
  if (old && old.kind!==kind) throw new Error('Conflicting provider for this browse session.')
  const value=record.parse({...key,kind,createdAt:old?.createdAt??now,closedAt:closed?now:old?.closedAt,restorePointId:restorePointId??old?.restorePointId})
  const tmp=target+'.'+randomUUID()
  await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700})
  try { await fs.writeFile(tmp,JSON.stringify(value),{flag:'wx',mode:0o600}); await replaceFile(tmp,target) }
  finally { await fs.unlink(tmp).catch(()=>{}) }
}
