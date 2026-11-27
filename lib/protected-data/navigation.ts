// Open Backup UI v1.3.0
export function isProtectedDataPath(pathname: string) {
  return pathname === '/vbr/protected-data' || pathname.startsWith('/vbr/protected-data/') || pathname.startsWith('/vbr/workloads/')
}
