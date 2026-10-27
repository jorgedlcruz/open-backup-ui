"use client"

import { useState } from "react"
import { VeeamOneGridNode } from "@/lib/types/veeam-one"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Folder, FileText, ChevronRight, CornerUpLeft } from "lucide-react"
import Link from "next/link"
import styles from "@/components/one-reports/reports.module.css"

interface SavedReportsBrowserProps {
    items: VeeamOneGridNode[]
}

export function SavedReportsBrowser({ items }: SavedReportsBrowserProps) {
    // Navigation stack to track folder history
    const [navStack, setNavStack] = useState<VeeamOneGridNode[]>([])

    // Current items to display: either root items or children of the last folder in stack
    const currentFolder = navStack.length > 0 ? navStack[navStack.length - 1] : null
    const displayItems = currentFolder ? (currentFolder.children || []) : items

    const handleFolderClick = (folder: VeeamOneGridNode) => {
        setNavStack([...navStack, folder])
    }

    const handleBackClick = () => {
        setNavStack(navStack.slice(0, -1))
    }

    const handleBreadcrumbClick = (index: number) => {
        setNavStack(navStack.slice(0, index + 1))
    }

    const handleRootClick = () => {
        setNavStack([])
    }

    if (!items || items.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground border-2 border-dashed rounded-xl">
                <Folder className="h-12 w-12 mb-4 opacity-20" />
                <h3 className="text-lg font-medium">No saved reports found</h3>
                <p className="text-sm">There are no saved reports available in this view.</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Header / Breadcrumbs */}
            <nav aria-label="Report folders" className={`${styles.breadcrumbs} overflow-x-auto pb-2`}>
                <Button
                    variant="ghost"
                    size="sm"
                    className={navStack.length === 0 ? "font-bold text-foreground" : ""}
                    onClick={handleRootClick}
                >
                    Root
                </Button>
                {navStack.map((folder, index) => (
                    <div key={folder.id} className="flex items-center">
                        <ChevronRight className="h-4 w-4 mx-1" />
                        <Button
                            variant="ghost"
                            size="sm"
                            className={index === navStack.length - 1 ? "font-bold text-foreground" : ""}
                            onClick={() => handleBreadcrumbClick(index)}
                        >
                            {folder.name}
                        </Button>
                    </div>
                ))}
            </nav>

            {/* Back Button (if deep) */}
            {navStack.length > 0 && (
                <div className="flex items-center">
                    <Button variant="ghost" size="sm" onClick={handleBackClick} className="gap-2">
                        <CornerUpLeft className="h-4 w-4" />
                        Back to {navStack.length > 1 ? navStack[navStack.length - 2].name : 'Root'}
                    </Button>
                </div>
            )}

            {/* Grid View */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {displayItems.map((item, index) => {
                    const isFolder = item.type === "Folder" || item.hasChildren

                    if (isFolder) {
                        return (
                            <Card
                                key={`${item.id}-${index}`}
                                className="cursor-pointer hover:bg-muted/50 transition-colors border-dashed hover:border-solid group"
                                onClick={() => handleFolderClick(item)}
                            >
                                <CardContent className="p-6 flex flex-col items-center text-center space-y-4">
                                    <div className="p-3 bg-blue-500/10 rounded-full group-hover:bg-blue-500/20 transition-colors">
                                        <Folder className="h-8 w-8 text-blue-600" />
                                    </div>
                                    <div className="space-y-1">
                                        <h3 className="font-medium truncate max-w-[200px]" title={item.name}>{item.name}</h3>
                                        <p className="text-xs text-muted-foreground">Folder</p>
                                    </div>
                                </CardContent>
                            </Card>
                        )
                    }

                    // Report Item
                    // TODO: Link to actual report details when ready, for now placeholder or generic link
                    return (
                        <Link href={`/analytics/reports/${item.id}`} key={`${item.id}-${index}`} className="block">
                            <Card className="h-full hover:bg-muted/50 transition-colors group border-l-4 border-l-green-500/0 hover:border-l-green-500">
                                <CardContent className="p-6 flex flex-col items-start space-y-4">
                                    <div className="flex items-center justify-between w-full">
                                        <div className="p-2 bg-green-500/10 rounded-md group-hover:bg-green-500/20 transition-colors">
                                            <FileText className="h-5 w-5 text-green-600" />
                                        </div>
                                    </div>
                                    <div className="space-y-1 w-full">
                                        <h3 className="font-medium leading-none truncate max-w-full" title={item.name}>{item.name}</h3>
                                        <p className="text-xs text-muted-foreground">Report</p>
                                    </div>
                                </CardContent>
                            </Card>
                        </Link>
                    )
                })}

                {displayItems.length === 0 && (
                    <div className="col-span-full py-12 text-center text-muted-foreground">
                        This folder is empty.
                    </div>
                )}
            </div>
        </div>
    )
}
