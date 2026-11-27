// Open Backup UI v1.3.0
import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getChunkedCookie, deleteChunkedCookie } from "@/lib/utils/cookie-manager"
import { configStore } from "@/lib/server/config-store"
import { vbrBrowserToken } from "@/lib/server/vbr-browser-token"

export const dynamic = 'force-dynamic';

const platformTokenCookies = {
    vbr: "veeam_vbr_token",
    vb365: "veeam_vb365_token",
    vro: "veeam_vro_token",
    "veeam-one": "veeam_one_token",
    one: "veeam_one_token",
    kasten: "kasten_token"
}

export async function GET() {
    try {
        const cookieStore = await cookies()
        const storedSources = configStore.getAll()

        const sessions: Record<string, { authenticated: boolean; url?: string }> = {}

        for (const [platform, cookieName] of Object.entries(platformTokenCookies)) {
            if (platform === 'vbr') {
                const source = configStore.getVbr()
                const url = source && `${source.protocol}://${source.host}:${source.port}`
                const selectedId = cookieStore.get('veeam_source_id')?.value
                sessions.vbr = {
                    authenticated: Boolean(url && (selectedId
                        ? configStore.getById(selectedId, false)?.platform === 'vbr'
                        : vbrBrowserToken(cookieStore, new URL(url)))),
                    url: url || undefined,
                }
                continue
            }
            let isAuthenticated = !!getChunkedCookie(cookieStore, cookieName)

            // Check for Source ID Cookie (Server-Side Auth)
            if (!isAuthenticated) {
                let cookieId: string;
                if (platform === 'veeam-one') {
                    cookieId = 'veeam_one_source_id';
                } else {
                    cookieId = `veeam_${platform}_source_id`;
                }
                isAuthenticated = !!cookieStore.get(cookieId)?.value
            }

            let url = cookieStore.get(`${cookieName}_url`)?.value

            // 1. Check Global Config Store (Preferred)
            const globalSource = storedSources.find(s => s.platform === (platform === 'veeam-one' ? 'one' : platform));
            if (globalSource) {
                url = `${globalSource.protocol}://${globalSource.host}:${globalSource.port}`;
            }

            // 2. Client-side cookie fallback logic (Legacy)
            // Fallback URL from cookie
            if (!url && isAuthenticated) {
                url = cookieStore.get(`${cookieName}_url`)?.value
            }

            sessions[platform] = {
                authenticated: isAuthenticated,
                url: url || undefined
            }
        }

        return NextResponse.json(sessions)
    } catch (error) {
        console.error("Session check error:", error)
        return NextResponse.json({})
    }
}

// Clear all sessions
export async function DELETE() {
    try {
        const cookieStore = await cookies()

        for (const cookieName of Object.values(platformTokenCookies)) {
            await deleteChunkedCookie(cookieStore, cookieName)
            cookieStore.delete(`${cookieName}_url`)
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error("Clear sessions error:", error)
        return NextResponse.json(
            { error: "Failed to clear sessions" },
            { status: 500 }
        )
    }
}
