// Open Backup UI v1.2.0
import { promises as fs } from 'node:fs'

const delays = [25, 50, 100, 200, 400, 800]
/** Windows readers and scanners can briefly deny replacement. Never unlink the
 * destination: callers rely on the previous durable record remaining intact. */
export async function replaceFile(source: string, destination: string) {
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(source, destination); return }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '') || attempt >= delays.length) throw error
      await new Promise(resolve => setTimeout(resolve, delays[attempt]))
    }
  }
}
