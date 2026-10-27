export class ApplicationRequestError extends Error {
  constructor(message: string, public kind: 'access' | 'network' | 'response', public status = 0) {
    super(message)
    this.name = 'ApplicationRequestError'
  }
}

const accessMessage = 'Your browser access session needs to be renewed. Reopen this page using HTTPS and complete the access sign-in, then retry. Your saved Veeam connections are still on the application server.'

// API calls must stay on the app origin. In particular, never follow an access
// gateway redirect with a POST containing credentials.
export async function applicationRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/api/')) throw new Error('Expected an application API path.')
  let response: Response
  try {
    response = await fetch(path, { ...init, credentials: 'same-origin', redirect: 'manual', cache: 'no-store' })
  } catch (error) {
    if (init.signal?.aborted) throw error
    throw new ApplicationRequestError('Unable to reach the application. Check your connection, or reopen this page to renew browser access, then retry. Saved connections have not been changed.', 'network')
  }
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    throw new ApplicationRequestError(accessMessage, 'access', response.status)
  }
  if (response.status === 204) return undefined as T
  const isJson = /\bapplication\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get('content-type') || '')
  if (!isJson) {
    if (response.status === 401 || response.status === 403 || (response.ok && response.headers.get('content-type')?.includes('text/html'))) {
      throw new ApplicationRequestError(accessMessage, 'access', response.status)
    }
    throw new ApplicationRequestError(`The application returned an unexpected response (HTTP ${response.status}). Please retry.`, 'response', response.status)
  }
  let data: T & { error?: unknown }
  try { data = await response.json() }
  catch { throw new ApplicationRequestError('The application returned an unreadable response. Please retry.', 'response', response.status) }
  if (!response.ok) {
    throw new ApplicationRequestError(typeof data?.error === 'string' ? data.error : `Application request failed (HTTP ${response.status}).`, 'response', response.status)
  }
  return data
}
