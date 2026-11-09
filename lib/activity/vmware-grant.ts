/** Interpret this grant only after VBR has authenticated the token. VBR 1.3-rev2 calls permission 101 StartViVMInstantRecovery. */
export function hasVmwareRestoreGrant(authenticatedToken: string | null) {
  try {
    const parts = authenticatedToken?.split('.')
    if (parts?.length !== 3) return false
    const { permissions } = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return Array.isArray(permissions) && permissions.some(value => value === 'StartViVMInstantRecovery' || value === '101' || value === 101)
  } catch { return false }
}
