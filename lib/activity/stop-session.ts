import { checkSource, VbrRecoveryError } from '../recovery/error'
import type { RecoverySend } from '../server/vbr-recovery'
import { investigationSessionSchema, validId } from '../investigation/model'
import { canStopEntireVm } from './session'

export async function stopEntireVm(send: RecoverySend, sourceKey: string, expected: string, id: string) {
  checkSource(expected, sourceKey)
  if (!validId(id)) throw new VbrRecoveryError('Select a valid session.')
  const path = '/api/v1/sessions/' + id
  const session = investigationSessionSchema.safeParse(await send(path))
  if (!session.success || session.data.id !== id || !canStopEntireVm(session.data)) {
    throw new VbrRecoveryError('This restore can no longer be stopped.', 409)
  }
  await send(path + '/stop', { method: 'POST', mutation: true })
  return { accepted: true }
}
