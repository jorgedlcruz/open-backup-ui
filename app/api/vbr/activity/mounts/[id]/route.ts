// Open Backup UI v1.2.0
import { after, NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { mountAction, runMountAction } from '@/lib/activity/actions'
import { mountPaths } from '@/lib/activity/model'
import { withVbrRecovery, type RecoverySend } from '@/lib/server/vbr-recovery'
import { checkSource, VbrRecoveryError } from '@/lib/recovery/error'
import { migrationBinding, MigrationOperations, type MigrationOutcome } from '@/lib/server/migration-operations'
import { saveMigrationLink } from '@/lib/server/migration-links'
import { investigationSessionSchema, validId } from '@/lib/investigation/model'
import { migrationTransfer } from '@/lib/activity/instant-vm'
import { resolveInventory } from '@/lib/recovery/inventory'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 1800
const operations = new MigrationOperations()
const command = mountAction.extend({requestId: z.uuid().optional()})
const headers = {'Cache-Control':'private, no-store'}
type Context = {params: Promise<{id: string}>}
const response = (receipt: MigrationOutcome) => NextResponse.json(receipt, {headers, status: receipt.state === 'checking' ? 202 : 200})

async function verifyReceiptAccess(send: RecoverySend, binding: z.infer<typeof migrationBinding>) {
  // A supplied bearer has not been authenticated until VBR accepts a scoped read.
  try {
    const session = z.object({id:z.string()}).safeParse(await send('/api/v1/sessions/' + binding.sessionId))
    if (session.success && session.data.id.toLowerCase() === binding.sessionId) return
  } catch (error) {
    if (!(error instanceof VbrRecoveryError) || ![403,404].includes(error.status)) throw error
  }
  // Mount-only sessions can be accessible even when VBR does not expose their history.
  const mount = z.object({id:z.string(),sessionId:z.string()}).safeParse(await send(mountPaths[binding.kind] + '/' + binding.mountId))
  if (!mount.success || mount.data.id.toLowerCase() !== binding.mountId || mount.data.sessionId.toLowerCase() !== binding.sessionId) {
    throw new VbrRecoveryError('Migration request not found.',404)
  }
}

export async function POST(request: NextRequest, {params}: Context) {
  const parsed = command.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({error:'Invalid recovery action.'}, {status:400, headers})
  const id = (await params).id.toLowerCase()
  const {requestId, ...action} = parsed.data
  action.sessionId = action.sessionId.toLowerCase()
  const run = async (send: RecoverySend, sourceKey: string) => {
    const result = await runMountAction(send, (ref, kind) => resolveInventory(send, ref, 'VSphere', kind), sourceKey, id, action)
    if (action.action === 'migrate' && (action.kind === 'vSphere' || action.kind === 'hyperV') &&
      result.accepted && validId(result.sessionId) && result.sessionId.toLowerCase() !== action.sessionId) {
      // An optional map link cannot undo an accepted migration or justify replaying it.
      await saveMigrationLink(sourceKey, action.sessionId, id, result.sessionId.toLowerCase(), result.destination).catch(() => {})
    }
    return {accepted:result.accepted, sessionId:result.sessionId}
  }
  if (!requestId) return withVbrRecovery(request, ({send, sourceKey}) => run(send, sourceKey))
  const binding = migrationBinding.safeParse({...action, sessionId:action.sessionId.toLowerCase(), mountId:id, requestId})
  if (action.action !== 'migrate' || !binding.success) return NextResponse.json({error:'Invalid migration request.'}, {status:400, headers})
  return withVbrRecovery(request, async ({send, sourceKey, bearerOnly}) => {
    checkSource(binding.data.sourceKey, sourceKey)
    if (bearerOnly) await verifyReceiptAccess(send,binding.data)
    const receipt = await operations.submit(binding.data, action, after, async () => {
      let dispatched = false
      const tracked: RecoverySend = (path, options) => {
        if (options?.mutation) dispatched = true
        return send(path, options)
      }
      try { return await run(tracked, sourceKey) }
      catch (error) {
        if (error instanceof VbrRecoveryError) throw error
        throw new VbrRecoveryError('The VBR response could not be processed.',502,dispatched)
      }
    }, async childId => {
      const result = investigationSessionSchema.safeParse(await send('/api/v1/sessions/' + childId))
      if (!result.success || result.data.id !== childId || result.data.sessionType !== 'QuickMigration' ||
        (validId(result.data.parentSessionId) && result.data.parentSessionId !== action.sessionId)) return false
      return ['failed','canceled'].includes(migrationTransfer(null,null,result.data).phase)
    })
    return response(receipt)
  }, {backgroundMigration:true})
}

export async function GET(request: NextRequest, {params}: Context) {
  const query = request.nextUrl.searchParams
  const binding = migrationBinding.safeParse({sourceKey:query.get('sourceKey'), sessionId:query.get('sessionId')?.toLowerCase(),
    kind:query.get('kind'), mountId:(await params).id.toLowerCase(), requestId:query.get('requestId')})
  if (!binding.success) return NextResponse.json({error:'Invalid migration request.'}, {status:400, headers})
  return withVbrRecovery(request, async ({send, sourceKey, bearerOnly}) => {
    checkSource(binding.data.sourceKey, sourceKey)
    if (bearerOnly) await verifyReceiptAccess(send,binding.data)
    return response(await operations.observe(binding.data))
  })
}
