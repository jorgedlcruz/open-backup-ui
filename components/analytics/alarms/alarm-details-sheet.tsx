"use client"

import { useEffect, useState } from "react"
import {
    Sheet,
    SheetContent,
    SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { TriggeredAlarmItem, AlarmTemplate } from "@/lib/types/veeam-one-alarms"
import { Loader2, X, ChevronUp, ChevronDown, Copy, Check } from "lucide-react"
import { toast } from "sonner"
import { VisuallyHidden } from "@radix-ui/react-visually-hidden"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

import { getAlarmDetailsAction, resolveAlarmAction } from "./actions"

interface AlarmDetailsSheetProps {
    alarm: TriggeredAlarmItem | null
    open: boolean
    onOpenChange: (open: boolean) => void
    onResolveSuccess: () => void
    onNavigatePrevious?: () => void
    onNavigateNext?: () => void
    hasPrevious?: boolean
    hasNext?: boolean
    currentIndex?: number
    totalCount?: number
}

// Copyable text block component
function CopyableTextBlock({ text, html }: { text?: string, html?: string }) {
    const [copied, setCopied] = useState(false)

    const handleCopy = async () => {
        const content = text || (html ? html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ') : '')
        if (!content) return

        try {
            await navigator.clipboard.writeText(content)
            setCopied(true)
            toast.success("Copied to clipboard")
            setTimeout(() => setCopied(false), 2000)
        } catch {
            toast.error("Failed to copy")
        }
    }

    return (
        <div className="relative group">
            <div
                className="w-full font-mono text-xs text-muted-foreground leading-relaxed break-words bg-muted/30 p-3 rounded-md border"
                dangerouslySetInnerHTML={html ? { __html: html.replace(/\n/g, '<br/>') } : undefined}
            >
                {text && !html ? text : null}
            </div>
            <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={handleCopy}
            >
                {copied ? (
                    <Check className="h-3 w-3 text-green-500" />
                ) : (
                    <Copy className="h-3 w-3" />
                )}
            </Button>
        </div>
    )
}

export function AlarmDetailsSheet({
    alarm,
    open,
    onOpenChange,
    onResolveSuccess,
    onNavigatePrevious,
    onNavigateNext,
    hasPrevious = false,
    hasNext = false,
    currentIndex = 0,
    totalCount = 0
}: AlarmDetailsSheetProps) {
    const [template, setTemplate] = useState<AlarmTemplate | null>(null)
    const [loading, setLoading] = useState(false)
    const [resolving, setResolving] = useState(false)
    const [comment, setComment] = useState("Resolved via Web UI")
    const [resolvePopoverOpen, setResolvePopoverOpen] = useState(false)

    useEffect(() => {
        if (open && alarm && alarm.alarmId) {
            setLoading(true)
            getAlarmDetailsAction(alarm.alarmId)
                .then(setTemplate)
                .catch((err: Error) => console.error(err))
                .finally(() => setLoading(false))
        } else {
            setTemplate(null)
        }
    }, [open, alarm])

    const handleResolve = async () => {
        if (!alarm || !alarm.triggeredSubAlarmId) return;

        setResolving(true)
        try {
            const success = await resolveAlarmAction([alarm.triggeredSubAlarmId], comment);
            if (success) {
                toast.success("Alarm resolved successfully")
                setResolvePopoverOpen(false)
                onResolveSuccess()
                onOpenChange(false)
            } else {
                toast.error("Failed to resolve alarm")
            }
        } catch {
            toast.error("An error occurred")
        } finally {
            setResolving(false)
        }
    }

    if (!alarm) return null

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-3/4 sm:max-w-md p-0 gap-0 overflow-y-auto" side="right">
                {/* Visually hidden title for accessibility */}
                <VisuallyHidden>
                    <SheetTitle>Alarm Details: {alarm.alarmName}</SheetTitle>
                </VisuallyHidden>

                {/* Header */}
                <div className="flex flex-col space-y-2 text-center sm:text-left sticky top-0 z-10 border-b bg-background p-4">
                    <div className="flex items-center justify-between gap-2">
                        <h2 className="text-lg font-semibold text-foreground font-mono truncate text-left w-full" title={alarm.alarmName}>
                            {alarm.alarmName}
                        </h2>
                        <div className="flex h-7 items-center gap-1 shrink-0">
                            {/* Navigation arrows - now functional */}
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={!hasPrevious}
                                onClick={onNavigatePrevious}
                                title="Previous alarm"
                            >
                                <ChevronUp className="h-5 w-5" />
                                <span className="sr-only">Previous</span>
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={!hasNext}
                                onClick={onNavigateNext}
                                title="Next alarm"
                            >
                                <ChevronDown className="h-5 w-5" />
                                <span className="sr-only">Next</span>
                            </Button>
                            {/* Counter indicator */}
                            {totalCount > 0 && (
                                <span className="text-xs text-muted-foreground tabular-nums px-1">
                                    {currentIndex}/{totalCount}
                                </span>
                            )}
                            <div className="shrink-0 bg-border h-full w-[1px] mx-1"></div>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onOpenChange(false)}>
                                <X className="h-5 w-5" />
                                <span className="sr-only">Close</span>
                            </Button>
                        </div>
                    </div>
                </div>

                <div className="p-4 space-y-6">
                    {/* Alarm Details */}
                    <div className="space-y-0 divide-y">
                        <div className="my-1 flex w-full items-center justify-between gap-4 py-2 text-sm">
                            <dt className="shrink-0 text-muted-foreground font-medium">Object</dt>
                            <dd className="w-full text-right font-mono truncate" title={alarm.entityName}>{alarm.entityName}</dd>
                        </div>
                        <div className="my-1 flex w-full items-center justify-between gap-4 py-2 text-sm">
                            <dt className="shrink-0 text-muted-foreground font-medium">Object type</dt>
                            <dd className="w-full text-right font-mono">{alarm.entityType}</dd>
                        </div>
                        <div className="my-1 flex w-full items-center justify-between gap-4 py-2 text-sm">
                            <dt className="shrink-0 text-muted-foreground font-medium">Alarm name</dt>
                            <dd className="w-full text-right font-mono truncate" title={alarm.alarmName}>{alarm.alarmName}</dd>
                        </div>
                        <div className="my-1 flex w-full items-center justify-between gap-4 py-2 text-sm">
                            <dt className="shrink-0 text-muted-foreground font-medium">Reason or Source</dt>
                            <dd className="w-full text-right font-mono text-xs text-muted-foreground line-clamp-2" title={alarm.source}>{alarm.source || '-'}</dd>
                        </div>
                        <div className="my-1 flex w-full items-center justify-between gap-4 py-2 text-sm">
                            <dt className="shrink-0 text-muted-foreground font-medium">Status</dt>
                            <dd className="w-full text-right font-mono">
                                <span className={`font-mono ${alarm.status === 'Error' ? 'text-red-500' :
                                    alarm.status === 'Warning' ? 'text-orange-500' :
                                        alarm.status === 'Resolved' ? 'text-green-500' : 'text-blue-500'
                                    }`}>
                                    {alarm.status}
                                </span>
                            </dd>
                        </div>
                        <div className="my-1 flex w-full items-center justify-between gap-4 py-2 text-sm">
                            <dt className="shrink-0 text-muted-foreground font-medium">Time</dt>
                            <dd className="w-full text-right font-mono">{new Date(alarm.time || '').toLocaleString()}</dd>
                        </div>
                    </div>

                    {/* Description */}
                    {alarm.description && (
                        <div className="space-y-2">
                            <dt className="text-sm font-medium text-muted-foreground">Description</dt>
                            <CopyableTextBlock html={alarm.description} />
                        </div>
                    )}

                    {/* Resolve Button - Right after Description (hidden if already Resolved) */}
                    {alarm.status !== 'Resolved' && (
                        <Popover open={resolvePopoverOpen} onOpenChange={setResolvePopoverOpen}>
                            <PopoverTrigger asChild>
                                <Button variant="outline" className="w-full">
                                    Resolve Alarm
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-80" align="center">
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="resolve-comment" className="text-sm font-medium">Resolution Comment</Label>
                                        <Textarea
                                            id="resolve-comment"
                                            placeholder="Enter reason for resolving..."
                                            value={comment}
                                            onChange={(e) => setComment(e.target.value)}
                                            rows={3}
                                            className="text-sm"
                                        />
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="flex-1"
                                            onClick={() => setResolvePopoverOpen(false)}
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            size="sm"
                                            className="flex-1"
                                            onClick={handleResolve}
                                            disabled={resolving || !comment.trim()}
                                        >
                                            {resolving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                                            Resolve
                                        </Button>
                                    </div>
                                </div>
                            </PopoverContent>
                        </Popover>
                    )}

                    {/* Knowledge Base Section - Same style as Description */}
                    <div className="space-y-4 pt-4 border-t">
                        <h3 className="text-sm font-medium text-muted-foreground">Knowledge Base</h3>

                        {loading ? (
                            <div className="flex justify-center py-8">
                                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                            </div>
                        ) : template ? (
                            <div className="space-y-4">
                                {template.knowledgeSummary && (
                                    <div className="space-y-2">
                                        <dt className="text-sm font-medium text-muted-foreground">Summary</dt>
                                        <CopyableTextBlock text={template.knowledgeSummary} />
                                    </div>
                                )}

                                {template.knowledgeCause && (
                                    <div className="space-y-2">
                                        <dt className="text-sm font-medium text-muted-foreground">Cause</dt>
                                        <CopyableTextBlock html={template.knowledgeCause} />
                                    </div>
                                )}

                                {template.knowledgeResolution && (
                                    <div className="space-y-2">
                                        <dt className="text-sm font-medium text-muted-foreground">Resolution</dt>
                                        <CopyableTextBlock html={template.knowledgeResolution} />
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="text-center text-muted-foreground py-4 text-sm">
                                No knowledge base article found.
                            </div>
                        )}
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    )
}
