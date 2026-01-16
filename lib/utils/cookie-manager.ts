import { cookies } from 'next/headers'
import { ResponseCookie } from 'next/dist/compiled/@edge-runtime/cookies'

const CHUNK_SIZE = 3500 // Safe margin below 4KB to account for headers/overhead

type CookieStore = Awaited<ReturnType<typeof cookies>>

/**
 * Sets a large cookie value by splitting it into chunks if necessary.
 * Standard browsers have a ~4KB limit per cookie.
 */
export async function setChunkedCookie(
    cookieStore: CookieStore,
    name: string,
    value: string,
    options: Partial<ResponseCookie>
) {
    // First clean up any existing chunks to avoid corruption
    await deleteChunkedCookie(cookieStore, name)

    if (value.length <= CHUNK_SIZE) {
        cookieStore.set(name, value, options)
        return
    }

    // Split into chunks
    const chunks = []
    let offset = 0
    while (offset < value.length) {
        chunks.push(value.slice(offset, offset + CHUNK_SIZE))
        offset += CHUNK_SIZE
    }

    // Set the main cookie and subsequent chunks
    // The main cookie (name) contains the first chunk
    // Subsequent cookies are named name.1, name.2, etc.
    cookieStore.set(name, chunks[0], options)

    for (let i = 1; i < chunks.length; i++) {
        cookieStore.set(`${name}.${i}`, chunks[i], options)
    }
}

/**
 * Retrieves a large cookie value by reconstructing it from chunks.
 */
export function getChunkedCookie(
    cookieStore: CookieStore,
    name: string
): string | undefined {
    const mainCookie = cookieStore.get(name)

    if (!mainCookie) return undefined

    let value = mainCookie.value
    let index = 1

    // Look for subsequent chunks
    while (true) {
        const chunk = cookieStore.get(`${name}.${index}`)
        if (!chunk) break

        value += chunk.value
        index++
    }

    return value
}

/**
 * Deletes a chunked cookie and all its parts.
 */
export async function deleteChunkedCookie(
    cookieStore: CookieStore,
    name: string
) {
    // Delete the main cookie
    cookieStore.delete(name)

    // Delete potential chunks (we try a reasonable number, e.g., up to 10 chunks)
    // We can't know exactly how many chunks there were without reading them, 
    // but deleting non-existent cookies is usually safe/no-op in this context
    for (let i = 1; i < 20; i++) {
        cookieStore.delete(`${name}.${i}`)
    }
}
