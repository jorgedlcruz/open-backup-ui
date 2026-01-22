"use client"

import React, { createContext, useContext, useState, useEffect, useCallback } from "react"

// Default section names (these are what Reset restores to)
const defaultSectionNames = {
    vbr: "Veeam Backup & Replication",
    vbm: "Veeam Backup for Microsoft 365",
    vro: "Veeam Recovery Orchestrator",
    analytics: "Veeam ONE",
    k10: "Kasten K10",
    administration: "Administration",
    documentation: "Documentation"
}

export type SectionKey = keyof typeof defaultSectionNames

interface SectionNamesContextType {
    sectionNames: Record<SectionKey, string>
    setSectionName: (key: SectionKey, name: string) => void
    resetSectionNames: () => void
    resetSectionName: (key: SectionKey) => void
    getDefaultName: (key: SectionKey) => string
}

const SectionNamesContext = createContext<SectionNamesContextType | null>(null)

const STORAGE_KEY = "open-backup-ui-section-names"

export function SectionNamesProvider({ children }: { children: React.ReactNode }) {
    const [sectionNames, setSectionNames] = useState<Record<SectionKey, string>>(defaultSectionNames)
    const [isHydrated, setIsHydrated] = useState(false)

    // Load from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY)
            if (stored) {
                const parsed = JSON.parse(stored)
                setSectionNames(prev => ({ ...prev, ...parsed }))
            }
        } catch (e) {
            console.error("Failed to load section names from localStorage:", e)
        }
        setIsHydrated(true)
    }, [])

    // Save to localStorage when names change (but not before hydration)
    useEffect(() => {
        if (isHydrated) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(sectionNames))
            } catch (e) {
                console.error("Failed to save section names to localStorage:", e)
            }
        }
    }, [sectionNames, isHydrated])

    const setSectionName = useCallback((key: SectionKey, name: string) => {
        setSectionNames(prev => ({
            ...prev,
            [key]: name || defaultSectionNames[key] // Fallback to default if empty
        }))
    }, [])

    const resetSectionNames = useCallback(() => {
        setSectionNames(defaultSectionNames)
    }, [])

    const resetSectionName = useCallback((key: SectionKey) => {
        setSectionNames(prev => ({
            ...prev,
            [key]: defaultSectionNames[key]
        }))
    }, [])

    const getDefaultName = useCallback((key: SectionKey) => {
        return defaultSectionNames[key]
    }, [])

    return (
        <SectionNamesContext.Provider value={{
            sectionNames,
            setSectionName,
            resetSectionNames,
            resetSectionName,
            getDefaultName
        }}>
            {children}
        </SectionNamesContext.Provider>
    )
}

export function useSectionNames() {
    const context = useContext(SectionNamesContext)
    if (!context) {
        throw new Error("useSectionNames must be used within a SectionNamesProvider")
    }
    return context
}

// For static/server components that need default names
export { defaultSectionNames }
