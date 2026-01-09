"use client"

import { LucideIcon, Database, Activity, Zap, Building2, HardDrive, Server, ShieldAlert, Key, Briefcase } from "lucide-react"

// Widget size constraints (using 12-column grid, cellHeight: 70px)
export interface WidgetSize {
    w: number  // width in grid units (1-12)
    h: number  // height in grid units
}

export interface WidgetDefinition {
    id: string
    title: string
    description: string
    category: 'stats' | 'charts' | 'tables' | 'info'
    icon: LucideIcon
    defaultSize: WidgetSize
    minSize: WidgetSize
    maxSize: WidgetSize
    component: string
    product: 'vbr' | 'vbm' | 'both'
}

// VBR Widget Definitions - 5 INDEPENDENT stat widgets + 3 main widgets
export const VBR_WIDGETS: WidgetDefinition[] = [
    // Independent stat cards
    {
        id: 'vbr-total-jobs',
        title: 'Total Jobs',
        description: 'Total backup jobs with active count',
        category: 'stats',
        icon: Briefcase,
        defaultSize: { w: 2, h: 14 },
        minSize: { w: 2, h: 14 },
        maxSize: { w: 4, h: 42 },
        component: 'TotalJobsCard',
        product: 'vbr'
    },
    {
        id: 'vbr-server',
        title: 'VBR Server',
        description: 'Server hostname, version and platform',
        category: 'stats',
        icon: Server,
        defaultSize: { w: 2, h: 14 },
        minSize: { w: 2, h: 14 },
        maxSize: { w: 4, h: 42 },
        component: 'VBRServerCard',
        product: 'vbr'
    },
    {
        id: 'vbr-license',
        title: 'License Usage',
        description: 'License consumption with progress bar',
        category: 'stats',
        icon: Key,
        defaultSize: { w: 2, h: 14 },
        minSize: { w: 2, h: 14 },
        maxSize: { w: 4, h: 42 },
        component: 'LicenseCard',
        product: 'vbr'
    },
    {
        id: 'vbr-malware',
        title: 'Malware Events',
        description: 'Malware detections with unresolved count',
        category: 'stats',
        icon: ShieldAlert,
        defaultSize: { w: 2, h: 14 },
        minSize: { w: 2, h: 14 },
        maxSize: { w: 4, h: 42 },
        component: 'MalwareEventsCard',
        product: 'vbr'
    },
    {
        id: 'vbr-security',
        title: 'Security Score',
        description: 'Best practices compliance with progress bar',
        category: 'stats',
        icon: ShieldAlert,
        defaultSize: { w: 2, h: 14 },
        minSize: { w: 2, h: 14 },
        maxSize: { w: 4, h: 42 },
        component: 'SecurityScoreCard',
        product: 'vbr'
    },
    // Main widgets
    {
        id: 'vbr-sessions',
        title: 'Sessions Overview',
        description: 'Recent backup sessions with chart and filtering',
        category: 'charts',
        icon: Activity,
        defaultSize: { w: 6, h: 91 }, // Updated to 6 wide, 13 tall equivalent (91)
        minSize: { w: 4, h: 56 },
        maxSize: { w: 10, h: 140 },
        component: 'SessionsOverview',
        product: 'vbr'
    },
    {
        id: 'vbr-storage',
        title: 'Storage Capacity',
        description: 'Repository storage usage and efficiency',
        category: 'info',
        icon: Database,
        defaultSize: { w: 4, h: 35 }, // Updated to 4 wide
        minSize: { w: 3, h: 28 },
        maxSize: { w: 8, h: 70 },
        component: 'StorageCapacityWidget',
        product: 'vbr'
    },
    {
        id: 'vbr-transfer',
        title: 'Transfer Rate',
        description: 'Data transfer rates over time',
        category: 'charts',
        icon: Zap,
        defaultSize: { w: 4, h: 49 }, // Updated to 4 wide, 7 tall equivalent (49)
        minSize: { w: 3, h: 28 },
        maxSize: { w: 8, h: 70 },
        component: 'TransferRateChart',
        product: 'vbr'
    },
]

// VBM Widget Definitions
export const VBM_WIDGETS: WidgetDefinition[] = [
    {
        id: 'vbm-orgs',
        title: 'Organizations',
        description: 'M365 organizations count',
        category: 'stats',
        icon: Building2,
        defaultSize: { w: 2, h: 14 },
        minSize: { w: 2, h: 14 },
        maxSize: { w: 4, h: 21 },
        component: 'VBMOrgsCard',
        product: 'vbm'
    },
    {
        id: 'vbm-sessions',
        title: 'Sessions Overview',
        description: 'Recent M365 backup sessions',
        category: 'charts',
        icon: Activity,
        defaultSize: { w: 7, h: 91 },
        minSize: { w: 6, h: 56 },
        maxSize: { w: 12, h: 140 },
        component: 'SessionsOverview',
        product: 'vbm'
    },
    {
        id: 'vbm-proxies',
        title: 'Backup Proxies',
        description: 'Proxy servers status',
        category: 'info',
        icon: Server,
        defaultSize: { w: 5, h: 35 },
        minSize: { w: 4, h: 28 },
        maxSize: { w: 8, h: 70 },
        component: 'VBMProxiesWidget',
        product: 'vbm'
    },
    {
        id: 'vbm-repos',
        title: 'Repositories',
        description: 'Backup repository capacity',
        category: 'info',
        icon: HardDrive,
        defaultSize: { w: 5, h: 49 },
        minSize: { w: 4, h: 35 },
        maxSize: { w: 8, h: 84 },
        component: 'VBMReposWidget',
        product: 'vbm'
    },
]

// Get all widgets for a product
export function getWidgetsForProduct(product: 'vbr' | 'vbm'): WidgetDefinition[] {
    if (product === 'vbr') return VBR_WIDGETS
    return VBM_WIDGETS
}

// Get widget by ID
export function getWidgetById(id: string): WidgetDefinition | undefined {
    return [...VBR_WIDGETS, ...VBM_WIDGETS].find(w => w.id === id)
}

// Widget categories for catalog filtering
export const WIDGET_CATEGORIES = [
    { id: 'all', label: 'All' },
    { id: 'stats', label: 'Statistics' },
    { id: 'charts', label: 'Charts' },
    { id: 'tables', label: 'Tables' },
    { id: 'info', label: 'Info' },
] as const

export type WidgetCategory = typeof WIDGET_CATEGORIES[number]['id']
