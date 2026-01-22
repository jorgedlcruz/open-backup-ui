"use client"

import React, { createContext, useContext, useState, useEffect, useCallback } from "react"

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

    // Load sources from server and check sessions on mount
    useEffect(() => {
        const init = async () => {
            try {
                // 1. Fetch Configured Sources (Server Truth)
                const sourcesRes = await fetch('/api/config/sources')
                let initialSources: DataSource[] = []

                if (sourcesRes.ok) {
                    initialSources = await sourcesRes.json()
                } else {
                    // Fallback to local storage if API fails
                    const stored = localStorage.getItem(STORAGE_KEY)
                    if (stored) {
                        initialSources = JSON.parse(stored)
                    }
                }

                // 2. Check Auth Status (Session)
                const sessionRes = await fetch('/api/auth/session')
                let sessions: Record<string, { authenticated: boolean }> = {}
                if (sessionRes.ok) {
                    sessions = await sessionRes.json()
                }

                // 3. Merge and Set
                const merged = initialSources.map(ds => {
                    const session = sessions[ds.type]
                    if (session && session.authenticated) {
                        return {
                            ...ds,
                            isAuthenticated: true,
                            lastAuthenticated: new Date().toISOString()
                        }
                    }
                    return { ...ds, isAuthenticated: false }
                })

                setDataSources(merged)
            } catch (e) {
                console.error("Data sources initialization failed:", e)
            } finally {
                setIsHydrated(true)
            }
        }

        init()
    }, [])

    // Save to localStorage when sources change (but not auth status)
    useEffect(() => {
        if (isHydrated) {
            try {
                // Store without sensitive runtime data
                const toStore = dataSources.map(({ id, type, name, url }) => ({ id, type, name, url, isAuthenticated: false }))
                localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore))
            } catch (e) {
                console.error("Failed to save data sources to localStorage:", e)
            }
        }
    }, [dataSources, isHydrated])

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
            hasAuthenticatedSource
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
