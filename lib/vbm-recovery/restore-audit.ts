// Open Backup UI v1.3.0
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { replaceFile } from '../server/atomic-file'
import { normalizeSession, RecoveryError, record, sessionBase, sessionIdSchema, workloadSchema, type JsonRecord, type RecoverySession, type Workload } from './model'
import { restoreItemResults, restoreResultCounts, type RestoreItemResult } from './restore-results'
import type { Execute } from './transport'

type Status = 'requested' | 'accepted' | 'failed' | 'unknown' | 'notSubmitted'
type Settings = Record<string, string | boolean>
export const earlierGroupStopped = 'An earlier group stopped this restore request.'
export const auditSaveFailed = 'The restore audit could not be saved.'
export type RestoreAuditEntry = {
  id: string; requestId: string; browseSessionId: string; sessionId?: string; submittedAt: string
  workload: Workload; source: string; authMode: 'certificate' | 'deviceCode' | 'credentials' | 'operator'
  settings: Settings; selection: { id: string; name?: string; path?: string }[]; status: Status; error?:typeof earlierGroupStopped
  outcome?: { observedAt: string; result?: string; counts: Partial<ReturnType<typeof restoreResultCounts>>; items: RestoreItemResult[] }
}
type Submission = Pick<RestoreAuditEntry, 'requestId' | 'browseSessionId' | 'workload' | 'source' | 'authMode' | 'settings' | 'selection'>
type Receipt = { status: Status; sessionId?: string }
type Reference = { browseSessionId: string; id: string }
type Availability = 'available' | 'unavailable'
const hex = z.string().regex(/^[a-f0-9]{64}$/)
const reference = z.object({ browseSessionId: sessionIdSchema, id: hex }).strict()
const maxBytes = 16 * 1024 * 1024
const stringOptions = ['mailbox', 'folder', 'siteURL', 'list', 'impersonationAccountName', 'casServer', 'officeRegion',
  'officeOrganizationName', 'organizationName', 'documentAction', 'documentVersion', 'documentLastVersionAction', 'fileVersion']
const flagOptions = ['changedItems', 'deletedItems', 'markRestoredAsUnread', 'excludeDrafts', 'excludeDeletedItems',
  'excludeInPlaceHoldItems', 'excludeLitigationHoldItems', 'restorePermissions', 'sendSharedLinksNotification',
  'restoreChangedItems', 'restoreMissingItems', 'restoreChangedTabs', 'restoreMissingTabs']
const settingKeys = new Set(['destination', 'applicationId', 'targetOneDriveId', 'originalMailboxFolder', ...stringOptions, ...flagOptions])
const label = z.string().max(2048)
const count = z.number().int().nonnegative().optional()
const entrySchema = z.object({
  id: hex, requestId: sessionIdSchema, browseSessionId: sessionIdSchema, sessionId: sessionIdSchema.optional(),
  submittedAt: z.string().datetime(), workload: workloadSchema, source: label,
  authMode: z.enum(['deviceCode', 'credentials', 'operator', 'certificate']),
  settings: z.record(z.string().refine(key => settingKeys.has(key)), z.union([label, z.boolean()])),
  selection: z.array(z.object({ id: label, name: label.optional(), path: label.optional() }).strict()).max(100),
  status: z.enum(['requested', 'accepted', 'failed', 'unknown', 'notSubmitted']),
  error: z.literal(earlierGroupStopped).optional(),
  outcome: z.object({ observedAt: z.string().datetime(), result: label.optional(),
    counts: z.object({ total: count, restored: count, failed: count, skipped: count }).strict(),
    items: z.array(z.object({ origin: z.enum(['statistics', 'event']), id: label.optional(), eventId: label.optional(),
      name: label, result: label, source: label.optional(), target: label.optional(), path: label.optional(), warnings: z.array(label).max(0) }).strict()),
  }).strict().optional(),
}).strict()

function text(value: unknown) {
  if (typeof value !== 'string') return undefined
  const clean = value.replace(/\p{Cc}/gu, ' ').trim().slice(0, 2048)
  if (/^https?:\/\//i.test(clean)) {
    try { const url = new URL(clean); return url.origin + url.pathname } catch { return undefined }
  }
  return clean || undefined
}

/** Only options accepted for this operation are retained. Never serialize the authentication or POST body. */
export function auditSettings(destination: string, body: JsonRecord, applicationId?: string): Settings {
  const settings: Settings = { destination }
  for (const key of stringOptions) {
    const value = text(body[key])
    if (value) settings[key] = value
  }
  for (const key of flagOptions) {
    if (typeof body[key] === 'boolean') settings[key] = body[key] as boolean
  }
  const drive = text(record(body.onedrive).id)
  if (drive) settings.targetOneDriveId = drive
  if (applicationId && z.string().uuid().safeParse(applicationId).success) settings.applicationId = applicationId
  return settings
}

/** Names and paths come from the source preflight. A cart label is never evidence of a restored item. */
export function auditSelection(entities: JsonRecord[]): RestoreAuditEntry['selection'] {
  return entities.map(row => ({
    id: text(row.id) || '',
    name: text(row.subject) || text(row.name) || text(row.title) || text(row.displayName),
    path: text(row.folderPath) || text(row.path),
  }))
}

function sanitizedResult(row: RestoreItemResult): RestoreItemResult {
  // Diagnostics can include free-form remote exception text. Store the item-level evidence, never its content.
  return { origin: row.origin, ...(row.eventId ? { eventId: text(row.eventId) } : {}), id: text(row.id),
    name: text(row.name) || '', result: text(row.result) || '', source: text(row.source), target: text(row.target),
    path: text(row.path), warnings: [] }
}

const waitForCheck = (delay: number) => new Promise<void>(resolve => { setTimeout(resolve, delay).unref() })
function auditRuntime() {
  return {pending:new Map<string,Promise<unknown>>(), inFlight:new Set<string>(), watchers:new Set<string>(),
    waiting:[] as (()=>void)[], activeReads:0}
}
export function createRestoreAudit(base: string, wait = waitForCheck, runtime = auditRuntime()) {
  const {pending,inFlight,watchers,waiting}=runtime
  async function backgroundRead(execute: Execute, path: string) {
    if (runtime.activeReads >= 4) await new Promise<void>(resolve => waiting.push(resolve))
    else runtime.activeReads++
    try { return await execute(path) }
    finally {
      const next = waiting.shift()
      if (next) next()
      else runtime.activeReads--
    }
  }
  function serial<T>(key: string, run: () => Promise<T>) {
    const previous = pending.get(key) || Promise.resolve()
    const next = previous.catch(() => {}).then(run)
    pending.set(key, next)
    return next.finally(() => { if (pending.get(key) === next) pending.delete(key) })
  }
  const dir = (scope: string, id: string) => path.join(base, hex.parse(scope), sessionIdSchema.parse(id).toLowerCase())
  const file = (scope: string, ref: Reference) => path.join(dir(scope, ref.browseSessionId), hex.parse(ref.id) + '.json')
  const missing = (err: unknown) => (err as NodeJS.ErrnoException).code === 'ENOENT'
  async function readJson(filename: string) {
    if ((await fs.stat(filename)).size > maxBytes) throw Error('Restore audit record is too large.')
    return JSON.parse(await fs.readFile(filename, 'utf8'))
  }
  async function save(filename: string, value: unknown) {
    const contents = JSON.stringify(value)
    if (Buffer.byteLength(contents) > maxBytes) throw Error('Restore audit record is too large.')
    const temp = filename + '.' + randomUUID()
    await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
    try {
      await fs.writeFile(temp, contents, { flag: 'wx', mode: 0o600 })
      await replaceFile(temp, filename)
    } finally { await fs.unlink(temp).catch(() => {}) }
  }
  async function childReference(scope: string, sessionId: string) {
    try { return reference.parse(await readJson(path.join(dir(scope, sessionId), 'parent.json'))) }
    catch (err) { if (missing(err)) return undefined; throw err }
  }
  async function readEntry(scope: string, ref: Reference): Promise<RestoreAuditEntry> {
    const filename = file(scope, ref)
    const value = entrySchema.parse(await readJson(filename))
    if (value.id !== ref.id || value.browseSessionId !== ref.browseSessionId) throw Error('Invalid restore audit record.')
    // A durable intent without a receipt after process loss or a failed save cannot attest to the write.
    return value.status === 'requested' && !inFlight.has(filename) ? { ...value, status: 'unknown' } : value
  }
  async function read(scope: string, sessionId: string): Promise<{ entries: RestoreAuditEntry[]; availability: Availability }> {
    try {
      const ref = await childReference(scope, sessionId)
      if (ref) {
        const entry = await readEntry(scope, ref).catch(() => undefined)
        if (!entry) return { entries: [], availability: 'unavailable' }
        if (entry.sessionId !== sessionId) throw Error('Restore session does not match its receipt.')
        return { entries: [entry], availability: 'available' }
      }
      // The time prefix orders groups without parsing every historical item result on every refresh.
      const names = (await fs.readdir(dir(scope, sessionId))).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort().reverse()
      const entries = []
      let bytes = 0, partial = names.length > 100
      for (const name of names.slice(0, 100)) {
        const ref = { browseSessionId: sessionId, id: name.slice(0, -5) }
        try {
          bytes += (await fs.stat(file(scope, ref))).size
          if (bytes > maxBytes) { partial = true; break }
          entries.push(await readEntry(scope, ref))
        } catch { partial = true }
      }
      return { entries, availability: partial ? 'unavailable' : 'available' }
    } catch (err) { return { entries: [], availability: missing(err) ? 'available' : 'unavailable' } }
  }
  async function reserve(scope: string, requestId: string, browseSessionId: string) {
    try {
      const directory = path.join(base, hex.parse(scope), 'requests')
      const filename = path.join(directory, sessionIdSchema.parse(requestId).toLowerCase() + '.json')
      await fs.mkdir(directory, { recursive: true, mode: 0o700 })
      const now = Date.now()
      await fs.writeFile(filename, JSON.stringify({ browseSessionId: sessionIdSchema.parse(browseSessionId), submittedAt: new Date(now).toISOString() }), { flag: 'wx', mode: 0o600 })
      return now
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new RecoveryError('This restore request is already recorded. Check its session log before retrying.', 409, true)
      throw new RecoveryError('The application could not record this request. No items were submitted.', 503)
    }
  }
  async function begin(scope: string, input: Submission, group: string, reservedAt: number, status: Status = 'requested') {
    const fingerprint = createHash('sha256').update(JSON.stringify([input.requestId, group])).digest('hex')
    const id = reservedAt.toString(16).padStart(12, '0') + fingerprint.slice(0, 52)
    const ref = { browseSessionId: input.browseSessionId, id }
    try {
      const filename = file(scope, ref)
      await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
      const entry = entrySchema.parse({ ...input, id, submittedAt: new Date().toISOString(), status,
        ...(status==='notSubmitted'?{error:earlierGroupStopped}:{}) })
      await fs.writeFile(filename, JSON.stringify(entry), { flag: 'wx', mode: 0o600 })
      if (status === 'requested') inFlight.add(filename)
      return ref
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new RecoveryError('This restore request is already recorded. Check its session log before retrying.', 409, true)
      const code=(err as NodeJS.ErrnoException).code
      if(err instanceof z.ZodError)throw new RecoveryError('The restore audit settings could not be validated.',503)
      if(code==='EACCES'||code==='EPERM')throw new RecoveryError('The application does not have permission to write the restore audit.',503)
      if(code==='ENOSPC'||code==='EDQUOT')throw new RecoveryError('The restore audit storage is full.',503)
      if(code==='ENAMETOOLONG')throw new RecoveryError('The restore audit file path is too long.',503)
      throw new RecoveryError(auditSaveFailed,503)
    }
  }
  async function finish(scope: string, ref: Reference | undefined, receipt: Receipt): Promise<Availability> {
    if (!ref) return 'unavailable'
    let filename: string | undefined
    try {
      const target = file(scope, ref)
      filename = target
      await serial(target, async () => {
        const entry = await readEntry(scope, ref)
        await save(target, { ...entry, status: receipt.status, ...(receipt.sessionId ? { sessionId: receipt.sessionId } : {}) })
        if (receipt.sessionId) {
          const child = dir(scope, receipt.sessionId)
          await fs.mkdir(child, { recursive: true, mode: 0o700 })
          try { await fs.writeFile(path.join(child, 'parent.json'), JSON.stringify(ref), { flag: 'wx', mode: 0o600 }) }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
            const existing = await childReference(scope, receipt.sessionId)
            if (existing?.browseSessionId !== ref.browseSessionId || existing?.id !== ref.id) throw Error('Restore session is already linked.')
          }
        }
      })
      return 'available'
    } catch { return 'unavailable' }
    finally { if (filename) inFlight.delete(filename) }
  }
  async function observe(scope: string, session: RecoverySession, statistics: unknown, events: JsonRecord[]): Promise<Availability> {
    if (session.state !== 'Stopped') return 'available'
    try {
      const ref = await childReference(scope, session.id)
      if (!ref) return 'available'
      const filename = file(scope, ref)
      await serial(filename, async () => {
        const entry = await readEntry(scope, ref)
        if (entry.sessionId !== session.id) throw Error('Restore session does not match its receipt.')
        const rows = restoreItemResults(statistics, events).map(sanitizedResult)
        const itemKey = (row: RestoreItemResult) => row.origin === 'statistics'
          ? JSON.stringify([row.origin, row.id, row.name, row.path])
          : JSON.stringify([row.origin, row.eventId, row.name, row.source, row.target, row.result])
        // Names alone are not identifiers. Preserve the multiplicity of otherwise identical Veeam rows.
        function indexed(items: RestoreItemResult[]) {
          const occurrences = new Map<string, number>()
          return items.map(row => {
            const key = itemKey(row), index = occurrences.get(key) || 0
            occurrences.set(key, index + 1)
            return [key + ':' + index, row] as const
          })
        }
        const items = new Map(indexed(entry.outcome?.items || []))
        for (const [key, row] of indexed(rows)) {
          const old = items.get(key)
          items.set(key, { ...row, eventId: row.eventId || old?.eventId, source: row.source || old?.source, target: row.target || old?.target })
        }
        const linkedEvents = new Set([...items.values()].filter(row => row.origin === 'statistics' && row.eventId).map(row => row.eventId))
        for (const [key, row] of items) if (row.origin === 'event' && linkedEvents.has(row.eventId)) items.delete(key)
        const counts = { ...entry.outcome?.counts }
        for (const [key, value] of Object.entries(restoreResultCounts(statistics))) if (typeof value === 'number') Object.assign(counts, { [key]: value })
        const result = text(session.result) || entry.outcome?.result
        const summary = { result, counts, items: [...items.values()] }
        const prior = entry.outcome
        if (prior && JSON.stringify(summary) === JSON.stringify({ result: prior.result, counts: prior.counts, items: prior.items })) return
        await save(filename, { ...entry, outcome: { ...summary, observedAt: new Date().toISOString() } })
      })
      return 'available'
    } catch { return 'unavailable' }
  }
  /** Complete receipts even if the browser closes. Only GETs, limited to this accepted child session. */
  function watch(scope: string, id: string, execute: Execute) {
    const key = scope + '/' + id
    if (watchers.has(key)) return true
    if (watchers.size >= 64) return false
    watchers.add(key)
    const until = Date.now() + 24 * 60 * 60 * 1000
    const collect = async () => {
      let delay = 15000, failures = 0, offset = 0, eventsComplete = false, statsAttempts = 0, statsSaved = false
      while (Date.now() < until) {
        await wait(delay)
        try {
          const path = sessionBase(id)
          const session = normalizeSession(await backgroundRead(execute, path))
          if (session.id !== id) return
          if (session.state === 'Stopped') {
            let stats: unknown = null
            if (!statsSaved && statsAttempts++ < 3) {
              stats = await backgroundRead(execute, path + '/Statistics').catch(() => null)
              if (await observe(scope, session, stats, []) === 'unavailable') throw Error('Restore audit is unavailable.')
              statsSaved = stats !== null
            }
            // A large event log yields to other completions every five pages; resume at its next offset.
            for (let page = 0; page < 5 && !eventsComplete; page++) {
              const raw = record(await backgroundRead(execute, path + '/Events?offset=' + offset + '&limit=200'))
              if (!Array.isArray(raw.results)) throw Error('Incomplete event collection.')
              if (await observe(scope, session, stats, raw.results.map(record)) === 'unavailable') throw Error('Restore audit is unavailable.')
              offset += raw.results.length
              eventsComplete = !raw.results.length || (raw.results.length < 200 && !record(raw._links).next)
              if (offset >= 10000000 || Date.now() >= until) return
            }
            if (eventsComplete && (statsSaved || statsAttempts >= 3)) return
          }
          failures = 0
        } catch (error) {
          if (++failures >= 4) return
          if (error instanceof RecoveryError && [401, 403].includes(error.status)) return
        }
        delay = Math.min(delay * 2, 300000)
      }
    }
    return collect().catch(() => {}).finally(() => watchers.delete(key))
  }
  return { reserve, begin, finish, observe, read, watch }
}

// Share the write locks and watchers across route bundles and reloads. Bind the
// current schema each time so a running preview can audit newly supported options.
const state = globalThis as typeof globalThis & { __vbmRestoreAuditRuntime?: ReturnType<typeof auditRuntime> }
export const restoreAudit = createRestoreAudit(path.join(process.cwd(),'data','vbm-restore-audit'),waitForCheck,state.__vbmRestoreAuditRuntime ||= auditRuntime())
