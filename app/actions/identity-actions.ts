"use server"

import { revalidatePath } from "next/cache"
import { veeamApi } from "@/lib/api/veeam-client"

export async function deleteUserAction(id: string) {
    try {
        await veeamApi.deleteUser(id)
        revalidatePath("/administration/identity")
        revalidatePath("/administration/identity/users")
        return { success: true }
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to delete user"
        console.warn("Delete user:", message)
        return { success: false, error: message }
    }
}

export async function resetMFAAction(id: string) {
    try {
        await veeamApi.resetMFA(id)
        return { success: true }
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to reset MFA"
        console.warn("Reset MFA:", message)
        return { success: false, error: message }
    }
}

export async function toggleServiceAccountAction(id: string, isServiceAccount: boolean) {
    try {
        await veeamApi.changeServiceAccountMode(id, isServiceAccount)
        revalidatePath("/administration/identity/users")
        return { success: true }
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update service account status"
        console.warn("Toggle service account:", message)
        return { success: false, error: message }
    }
}

export async function updateMFAAction(enabled: boolean) {
    try {
        await veeamApi.updateSecuritySettings({ mfaEnabled: enabled })
        revalidatePath("/administration/identity/users")
        return { success: true }
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update MFA settings"
        console.warn("Update MFA settings:", message)
        return { success: false, error: message }
    }
}
