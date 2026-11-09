// Open Backup UI v1.0.2
export function isProtectedDataPath(pathname: string) {
  return pathname === '/vbr/protected-data' || pathname.startsWith('/vbr/protected-data/') || pathname.startsWith('/vbr/workloads/')
}
