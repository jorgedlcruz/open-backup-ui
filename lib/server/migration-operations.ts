// Open Backup UI v1.2.0
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { validId } from '../investigation/model'
import { VbrRecoveryError } from '../recovery/error'
import { withFileLease } from './file-lease'

export const migrationBinding = z.object({
  sourceKey: z.string().regex(/^[a-f0-9]{64}$/), kind: z.enum(['vSphere', 'hyperV']),
  mountId: z.string().refine(validId), sessionId: z.string().refine(validId),
  requestId: z.uuid().refine(validId).transform(value => value.toLowerCase()),
})
type Binding = z.infer<typeof migrationBinding>
export type MigrationOutcome = {state:'checking'|'accepted'|'rejected'|'unknown'; sessionId?:string; error?:string}
const outcomeSchema = z.object({state:z.enum(['checking','accepted','rejected','unknown']),sessionId:z.string().refine(validId).optional(),error:z.string().max(1000).optional()})
const recordSchema = z.object({binding:migrationBinding, payloadHash:z.string().length(64), created:z.number(), outcome:outcomeSchema})
type Record = z.infer<typeof recordSchema>
type Work = () => Promise<{accepted:boolean; sessionId:string|null}>
type Schedule = (callback:() => Promise<void>) => void
const unknown = 'The result is unknown. Check Sessions before trying again.'
const checkingTimeout = 30 * 60_000
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const matches = (a: Binding, b: Binding) => a.sourceKey === b.sourceKey && a.kind === b.kind &&
  a.mountId === b.mountId && a.sessionId === b.sessionId && a.requestId === b.requestId

export class MigrationOperations {
  constructor(private directory = path.join(process.cwd(), 'data', 'migration-operations'), private now = Date.now) {}
  private file(binding: Binding) { return path.join(this.directory, digest([binding.sourceKey,binding.requestId]) + '.json') }
  private async read(file: string) {
    try { return recordSchema.parse(JSON.parse(await fs.readFile(file, 'utf8'))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }
  private async legacyLatest(slot: string, binding: Binding) {
    let requestId: string
    try { requestId = await fs.readFile(slot,'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    if (!validId(requestId)) throw new VbrRecoveryError('The previous migration request could not be verified.',503)
    const record = await this.read(this.file({...binding, requestId}))
    if (!record || !matches(record.binding,{...binding,requestId})) throw new VbrRecoveryError('The previous migration request could not be verified.',503)
    return record
  }
  private async latest(slot: string, binding: Binding) {
    let next = slot + '.attempt', last: Record | null = null
    // Immutable links make the latest native attempt independent of an advisory
    // lock or a mutable "last request" pointer. Never reclaim an interrupted link.
    for (let count = 0; count < 256; count++) {
      const claim = await this.read(next)
      if (!claim) return {record:last || await this.legacyLatest(slot,binding), next}
      if (!matches(claim.binding,{...binding,requestId:claim.binding.requestId}) || claim.outcome.state !== 'checking') {
        throw new VbrRecoveryError('The previous migration request could not be verified.',503)
      }
      const saved = await this.read(this.file(claim.binding))
      if (saved && (!matches(saved.binding,claim.binding) || saved.payloadHash !== claim.payloadHash || saved.created !== claim.created)) {
        throw new VbrRecoveryError('The previous migration request could not be verified.',503)
      }
      last = saved || claim
      next = slot + '.after-' + claim.binding.requestId + '.attempt'
    }
    throw new VbrRecoveryError('The migration request history could not be verified.',503)
  }
  private async publish(file: string, record: Record) {
    const temp = file + '.' + randomUUID() + '.tmp'
    await fs.mkdir(path.dirname(file),{recursive:true})
    try {
      await fs.writeFile(temp,JSON.stringify(recordSchema.parse(record)),{flag:'wx',mode:0o600})
      try { await fs.link(temp,file); return true }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error }
    } finally { await fs.unlink(temp).catch(() => {}) }
  }
  private async write(file: string, record: Record) {
    const temp = file + '.' + randomUUID() + '.tmp'
    try {
      await fs.writeFile(temp, JSON.stringify(record), {flag:'wx',mode:0o600})
      await fs.rename(temp, file)
    } finally { await fs.unlink(temp).catch(() => {}) }
  }
  private current(record: Record): MigrationOutcome {
    // A process may have exited after VBR received the POST. Never replay an abandoned receipt.
    if (record.outcome.state === 'checking' && this.now() - record.created >= checkingTimeout) return {state:'unknown', error:unknown}
    return record.outcome
  }
  async observe(binding: Binding): Promise<MigrationOutcome> {
    const record = await this.read(this.file(binding))
    if (!record || !matches(record.binding,binding)) throw new VbrRecoveryError('Migration request not found.',404)
    return this.current(record)
  }
  async submit(binding: Binding, payload: unknown, schedule: Schedule, work: Work,
    failedMigration?: (sessionId:string) => Promise<boolean>): Promise<MigrationOutcome> {
    const payloadHash = digest(payload), file = this.file(binding)
    const existing = (record: Record) => {
      if (!matches(record.binding,binding) || record.payloadHash !== payloadHash) {
        throw new VbrRecoveryError('This migration request ID was already used for different settings.',409)
      }
      return this.current(record)
    }
    const saved = await this.read(file)
    if (saved) return existing(saved)
    const slot = path.join(this.directory, 'mount-' + digest([binding.sourceKey,binding.kind,binding.sessionId,binding.mountId]))
    const {record:lastObserved} = await this.latest(slot,binding)
    const childId = lastObserved?.outcome.sessionId
    // The parent can still be Mounted minutes after a migration is accepted. Only VBR's
    // exact failed/canceled child makes a second submission on this mount safe.
    const retryOf = lastObserved?.outcome.state === 'accepted' && childId && childId !== binding.sessionId &&
      failedMigration && await failedMigration(childId).catch(() => false) ? lastObserved.binding.requestId : undefined
    // Serialize only the short reservation. No network calls run while holding this lease.
    const reserve = async (): Promise<MigrationOutcome> => {
      const previous = await this.read(file)
      if (previous) return existing(previous)
      const {record:last,next} = await this.latest(slot,binding)
      // A concurrent observer can see the claim before its request receipt is
      // published. It observes the same reservation and never schedules it.
      if (last && matches(last.binding,binding)) return existing(last)
      if (last?.outcome.state === 'accepted' && last.binding.requestId !== retryOf) {
        if (last.payloadHash !== payloadHash) throw new VbrRecoveryError('This mount already has an accepted migration. Check the migration session.',409)
        if (!await this.publish(file, {...last,binding})) return existing((await this.read(file))!)
        return last.outcome
      }
      if (last && ['checking','unknown'].includes(last.outcome.state)) {
        throw new VbrRecoveryError(this.current(last).state === 'checking' ? 'Another migration request for this mount is being checked.' : unknown,409)
      }
      const record: Record = {binding, payloadHash, created:this.now(), outcome:{state:'checking'}}
      // Only the winner of this immutable generation may schedule work. The
      // reusable lease improves contention but cannot authorize a second POST.
      if (!await this.publish(next,record)) return reserve()
      if (!await this.publish(file,record)) {
        existing((await this.read(file))!)
        throw new VbrRecoveryError('The migration request could not be reserved. Check Sessions before trying again.',409)
      }
      const complete = async () => {
        if (this.now() - record.created >= checkingTimeout) return
        if (!await this.publish(next+'.dispatch',record)) return
        let outcome: MigrationOutcome
        try {
          const result = await work()
          outcome = result.accepted ? {state:'accepted', ...(validId(result.sessionId) ? {sessionId:result.sessionId.toLowerCase()} : {})}
            : {state:'unknown', error:unknown}
        } catch (error) {
          outcome = error instanceof VbrRecoveryError && !error.uncertain
            ? {state:'rejected',error:error.message.slice(0,1000)} : {state:'unknown',error:unknown}
        }
        await this.write(file,{...record,outcome})
      }
      try { schedule(complete) }
      catch {
        record.outcome = {state:'rejected', error:'The migration could not be scheduled.'}
        await this.write(file,record)
      }
      return record.outcome
    }
    // A repeated POST can arrive while the first worker is reserving its receipt.
    const lock = path.join(this.directory, 'reserve.lock')
    for (let attempt = 0; attempt < 10; attempt++) {
      const outcome = await withFileLease(lock, 30_000, reserve)
      if (outcome) return outcome
      const current = await this.read(file)
      if (current) return existing(current)
      await new Promise(resolve => setTimeout(resolve, 30 + attempt * 10))
    }
    throw new VbrRecoveryError('The migration request could not be reserved. Check Sessions before trying again.',503)
  }
}
