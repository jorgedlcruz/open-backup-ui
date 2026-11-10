// Open Backup UI v1.2.0
export class VbrRecoveryError extends Error {
  constructor(message: string, readonly status = 400, readonly uncertain = false) { super(message) }
}

export function checkSource(expected: string, current: string) {
  if (expected !== current) throw new VbrRecoveryError('The connected VBR source changed. Reopen this workflow.', 409)
}
