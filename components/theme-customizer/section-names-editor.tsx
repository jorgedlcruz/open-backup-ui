"use client"

import { useSectionNames, SectionKey } from "@/lib/context/section-names-context"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { RotateCcw } from "lucide-react"

const sectionLabels: Record<SectionKey, string> = {
    vbr: "Veeam Backup & Replication",
    vbm: "Veeam Backup for Microsoft 365",
    vro: "Veeam Recovery Orchestrator",
    analytics: "Veeam ONE",
    k10: "Kasten K10",
    administration: "Administration",
    documentation: "Documentation"
}

const sectionOrder: SectionKey[] = ["vbr", "vbm", "vro", "analytics", "k10", "administration", "documentation"]

export function SectionNamesEditor() {
    const { sectionNames, setSectionName, resetSectionName, resetSectionNames, getDefaultName } = useSectionNames()

    return (
        <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sectionOrder.map((key) => (
                    <div key={key} className="space-y-1.5">
                        <label htmlFor={`section-name-${key}`} className="text-xs font-medium text-muted-foreground">
                            {sectionLabels[key]}
                        </label>
                        <div className="flex gap-1.5">
                            <Input
                                id={`section-name-${key}`}
                                value={sectionNames[key]}
                                onChange={(e) => setSectionName(key, e.target.value)}
                                placeholder={getDefaultName(key)}
                                className="h-9"
                            />
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => resetSectionName(key)}
                                title={`Reset to "${getDefaultName(key)}"`}
                                aria-label={`Reset ${sectionLabels[key]} label`}
                                className="shrink-0 h-9 w-9"
                            >
                                <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
            <Button variant="outline" size="sm" onClick={resetSectionNames}>
                <RotateCcw className="h-3.5 w-3.5 mr-2" />
                Reset All
            </Button>
        </div>
    )
}
