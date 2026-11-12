// Open Backup UI v1.2.0
export const recoveryCenterPath = '/vbr/recovery-center'
export const sessionsPath = '/vbr/activity'
export type SessionHome = typeof recoveryCenterPath | typeof sessionsPath

export function sessionHomeFor(path: string | null): SessionHome {
  return path === recoveryCenterPath || path?.startsWith(recoveryCenterPath + '/') ? recoveryCenterPath : sessionsPath
}

export function sessionHref(home: SessionHome, id: string, sourceKey?: string) {
  const path = home + '/' + encodeURIComponent(id)
  return sourceKey ? path + '?' + new URLSearchParams({sourceKey}) : path
}
