import {promises as fs} from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'

/** Local/shared-data-directory coordination. Lease duration must exceed the bounded operation. */
export async function withFileLease<T>(file:string, durationMs:number, work:()=>Promise<T>):Promise<T|null> {
  await fs.mkdir(path.dirname(file),{recursive:true})
  const owner=randomUUID()
  try { await fs.writeFile(file,JSON.stringify({owner,expires:Date.now()+durationMs}),{flag:'wx',mode:0o600}) }
  catch(error) {
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error
    // A crashed worker cannot hold the collector forever. Retry on a later tick,
    // rather than assuming ownership after removing an expired lease.
    try {
      let expires:number
      try { const existing=JSON.parse(await fs.readFile(file,'utf8'));expires=typeof existing.expires==='number'?existing.expires:NaN }catch{expires=NaN}
      // A crash during the initial write can leave a truncated lock record.
      if(!Number.isFinite(expires))expires=(await fs.stat(file)).mtimeMs+durationMs
      if(expires<Date.now())await fs.unlink(file)
    }catch{}
    return null
  }
  try{return await work()}
  finally {
    try { const current=JSON.parse(await fs.readFile(file,'utf8'));if(current.owner===owner)await fs.unlink(file) }catch{}
  }
}
