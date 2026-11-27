// Open Backup UI v1.3.0
// Older browser tabs may still submit to this retired endpoint.
export function POST() {
  return Response.json({
    error: 'Delegated recovery is available in Veeam Restore Portal. Refresh this page to use administrator recovery.',
    outcomeUnknown: false,
  }, { status: 410, headers: { 'Cache-Control': 'private, no-store' } })
}
