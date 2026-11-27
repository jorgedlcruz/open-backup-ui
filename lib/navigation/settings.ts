// Open Backup UI v1.3.0
export function isSettingsPath(pathname: string) {
  return pathname === '/settings' || pathname.startsWith('/settings/')
}

export function settingsReturnPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return '/dashboard'
  try {
    const origin = 'https://workspace.invalid'
    const url = new URL(value, origin)
    if (url.origin === origin && /^\/(dashboard|vbr|vbm|vro|analytics|labs|k10)(?:\/|$)/.test(url.pathname)) {
      return url.pathname + url.search + url.hash
    }
  } catch { /* Invalid or obsolete session data. */ }
  return '/dashboard'
}
