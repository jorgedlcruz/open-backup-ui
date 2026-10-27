"use client"

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react"
import { clientSources, loadClientSources } from '../data-sources/client'

// Platform types
export type PlatformType = 'vbr' | 'vb365' | 'vro' | 'veeam-one' | 'one' | 'kasten'

// Platform display info
export const platformInfo: Record<PlatformType, { name: string; description: string; color: string }> = {
    vbr: { name: "Veeam Backup & Replication", description: "Virtual, physical, and cloud backup", color: "#00b336" },
    vb365: { name: "Veeam Backup for Microsoft 365", description: "Microsoft 365 data protection", color: "#0078d4" },
    vro: { name: "Veeam Recovery Orchestrator", description: "Disaster recovery automation", color: "#9333ea" },
    "veeam-one": { name: "Veeam ONE", description: "Monitoring and analytics", color: "#f97316" },
    one: { name: "Veeam ONE", description: "Monitoring and analytics", color: "#f97316" },
    kasten: { name: "Kasten K10", description: "Kubernetes data management", color: "#ef4444" }
}

// Data source model
export interface DataSource {
    id: string
    type: PlatformType
    name: string
    url: string
    isAuthenticated: boolean
    hasCredentials?: boolean
    managed?: 'saved' | 'environment'
    lastAuthenticated?: string
}

// Context interface
interface DataSourcesContextType {
    dataSources: DataSource[]
    addDataSource: (type: PlatformType, url: string, name?: string) => DataSource
    updateDataSource: (id: string, updates: Partial<Pick<DataSource, 'url' | 'name'>>) => void
    removeDataSource: (id: string) => void
    getDataSource: (id: string) => DataSource | undefined
    getDataSourceByType: (type: PlatformType) => DataSource | undefined
    setAuthenticated: (id: string, authenticated: boolean) => void
    hasAnyDataSource: boolean
    hasAuthenticatedSource: boolean
    isLoading: boolean
    loadError: string | null
    reloadSources: () => Promise<boolean>
}

const DataSourcesContext = createContext<DataSourcesContextType | null>(null)

const STORAGE_KEY = "open-backup-ui-data-sources"

// Generate unique ID
function generateId(): string {
    return `ds-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export function DataSourcesProvider({ children }: { children: React.ReactNode }) {
    const [dataSources, setDataSources] = useState<DataSource[]>([])
    const [isHydrated, setIsHydrated] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const requestVersion = useRef(0)

    const reloadSources = useCallback(async (signal?: AbortSignal) => {
        const version = ++requestVersion.current
        setIsLoading(true)
        try {
            const sources = await loadClientSources(signal)
            if (signal?.aborted || version !== requestVersion.current) return false
            setDataSources(sources)
            setLoadError(null)
            setIsHydrated(true)
            return true
        } catch (error) {
            if (signal?.aborted || version !== requestVersion.current) return false
            setLoadError(error instanceof Error ? error.message : 'Data sources could not be loaded. Please retry.')
            // Preserve existing metadata on network/access failure. Cached rows
            // never establish authentication and are not written back on failure.
            try {
                const stored = localStorage.getItem(STORAGE_KEY)
                const fallback = stored ? clientSources(JSON.parse(stored), true) : []
                setDataSources(previous => previous.length ? previous : fallback)
            } catch { /* An unavailable browser cache does not erase server configuration. */ }
            return false
        } finally {
            if (!signal?.aborted && version === requestVersion.current) setIsLoading(false)
        }
    }, [])

    useEffect(() => {
        const controller = new AbortController()
        void reloadSources(controller.signal)
        return () => { controller.abort() }
    }, [reloadSources])

    // Save to localStorage when sources change (but not auth status)
    useEffect(() => {
        if (isHydrated && !loadError) {
            try {
                // Store without sensitive runtime data
                const toStore = dataSources.map(({ id, type, name, url }) => ({ id, type, name, url, isAuthenticated: false }))
                localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore))
            } catch { /* Server-backed connections also work without localStorage. */ }
        }
    }, [dataSources, isHydrated, loadError])

    const addDataSource = useCallback((type: PlatformType, url: string, name?: string): DataSource => {
        const newSource: DataSource = {
            id: generateId(),
            type,
            name: name || platformInfo[type].name,
            url: url.replace(/\/+$/, ''), // Remove trailing slashes
            isAuthenticated: false
        }
        setDataSources(prev => [...prev, newSource])
        return newSource
    }, [])

    const updateDataSource = useCallback((id: string, updates: Partial<Pick<DataSource, 'url' | 'name'>>) => {
        setDataSources(prev => prev.map(ds => {
            if (ds.id === id) {
                const updated = { ...ds, ...updates }
                if (updates.url) {
                    updated.url = updates.url.replace(/\/+$/, '')
                    updated.isAuthenticated = false // Reset auth when URL changes
                    updated.hasCredentials = false
                    updated.managed = undefined
                }
                return updated
            }
            return ds
        }))
    }, [])

    const removeDataSource = useCallback((id: string) => {
        setDataSources(prev => prev.filter(ds => ds.id !== id))
    }, [])

    const getDataSource = useCallback((id: string) => {
        return dataSources.find(ds => ds.id === id)
    }, [dataSources])

    const getDataSourceByType = useCallback((type: PlatformType) => {
        return dataSources.find(ds => ds.type === type)
    }, [dataSources])

    const setAuthenticated = useCallback((id: string, authenticated: boolean) => {
        setDataSources(prev => prev.map(ds => {
            if (ds.id === id) {
                return {
                    ...ds,
                    isAuthenticated: authenticated,
                    lastAuthenticated: authenticated ? new Date().toISOString() : ds.lastAuthenticated
                }
            }
            return ds
        }))
    }, [])

    const hasAnyDataSource = dataSources.length > 0
    const hasAuthenticatedSource = dataSources.some(ds => ds.isAuthenticated)

    return (
        <DataSourcesContext.Provider value={{
            dataSources,
            addDataSource,
            updateDataSource,
            removeDataSource,
            getDataSource,
            getDataSourceByType,
            setAuthenticated,
            hasAnyDataSource,
            hasAuthenticatedSource,
            isLoading,
            loadError,
            reloadSources
        }}>
            {children}
        </DataSourcesContext.Provider>
    )
}

export function useDataSources() {
    const context = useContext(DataSourcesContext)
    if (!context) {
        throw new Error("useDataSources must be used within a DataSourcesProvider")
    }
    return context
}
