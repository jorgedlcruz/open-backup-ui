import { createHash } from 'node:crypto'

// Configured credentials identify the principal across OAuth renewals. Legacy sessions
// have no trusted configured identity, so they remain isolated by their bearer token.
export function readCacheScope(destination: string, token: string, source?: { id: string; username?: string; password?: string }) {
  return createHash('sha256').update(JSON.stringify([destination, source
    ? ['source', source.id, source.username, source.password]
    : ['session', token]])).digest('hex')
}
