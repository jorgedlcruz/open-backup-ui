"use client"

// Dashboard layout persistence utilities

export interface GridStackItemLayout {
    id: string
    x: number
    y: number
    w: number
    h: number
}

export interface DashboardLayout {
    version: number // For future migrations
    items: GridStackItemLayout[]
    timestamp: number
}

const LAYOUT_VERSION = 3
const STORAGE_KEY_PREFIX = 'veeam-dashboard-layout-'

/**
 * Save dashboard layout to localStorage
 */
export function saveDashboardLayout(productId: 'vbr' | 'vbm', items: GridStackItemLayout[]): void {
    try {
        const layout: DashboardLayout = {
            version: LAYOUT_VERSION,
            items,
            timestamp: Date.now()
        }
        localStorage.setItem(
            `${STORAGE_KEY_PREFIX}${productId}`,
            JSON.stringify(layout)
        )
    } catch (error) {
        console.error('Failed to save dashboard layout:', error)
    }
}

/**
 * Load dashboard layout from localStorage
 */
export function loadDashboardLayout(productId: 'vbr' | 'vbm'): GridStackItemLayout[] | null {
    try {
        const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${productId}`)
        if (!stored) return null

        const layout: DashboardLayout = JSON.parse(stored)

        // Version check for future migrations
        if (layout.version !== LAYOUT_VERSION) {
            console.log('Layout version mismatch, resetting to default')
            return null
        }

        return layout.items
    } catch (error) {
        console.error('Failed to load dashboard layout:', error)
        return null
    }
}

/**
 * Reset dashboard layout to defaults
 */
export function resetDashboardLayout(productId: 'vbr' | 'vbm'): void {
    try {
        localStorage.removeItem(`${STORAGE_KEY_PREFIX}${productId}`)
    } catch (error) {
        console.error('Failed to reset dashboard layout:', error)
    }
}

/**
 * Check if a custom layout exists
 */
export function hasCustomLayout(productId: 'vbr' | 'vbm'): boolean {
    try {
        return localStorage.getItem(`${STORAGE_KEY_PREFIX}${productId}`) !== null
    } catch {
        return false
    }
}
