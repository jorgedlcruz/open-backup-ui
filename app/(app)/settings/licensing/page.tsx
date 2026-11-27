// Open Backup UI v1.3.0
import { LicensingClient } from "@/components/administration/licensing-client"
import { cookies } from "next/headers"
import { configStore } from "@/lib/server/config-store"
import { sessionKeys, workspaceConnections } from "@/lib/data-sources/model"

export default async function LicensingPage() {
    const cookieStore = await cookies()
    const connections = workspaceConnections(cookieStore, process.env, configStore.getAll())
    const selectedSources = [sessionKeys.vbr, sessionKeys.vb365].map(keys =>
        cookieStore.get(keys.id)?.value || cookieStore.get(keys.token + '_url')?.value || null
    )
    return <LicensingClient key={JSON.stringify(selectedSources)} hasVBR={connections.vbr} hasVB365={connections.vb365} />
}
