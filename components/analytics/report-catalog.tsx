"use client"
import { FilterFields } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import { FacetedFilter } from "@/components/faceted-filter"
import { Badge } from "@/components/ui/badge"
import { Card,CardContent,CardDescription,CardFooter,CardHeader,CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { VeeamOneReportTemplate,VeeamOneTag } from "@/lib/types/veeam-one"
import { FileText } from "lucide-react"
import Link from "next/link"
import { useMemo,useState } from "react"

interface ReportCatalogProps {
    templates: VeeamOneReportTemplate[]
    tags: VeeamOneTag[]
}

export function ReportCatalog({ templates, tags }: ReportCatalogProps) {
    const [searchQuery, setSearchQuery] = useState("")
    const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())

    const tagMap = useMemo(() => {
        return tags.reduce((acc, tag) => {
            acc[tag.tagId] = tag.tag
            return acc
        }, {} as Record<number, string>)
    }, [tags])

    const tagOptions = useMemo(() => {
        return tags.map(tag => ({
            label: tag.tag,
            value: tag.tagId.toString()
        }))
    }, [tags])

    const tagCounts = useMemo(() => {
        const counts: Record<string, number> = {}
        tags.forEach(tag => {
            counts[tag.tagId.toString()] = 0
        })

        templates.forEach(template => {
            template.tags.forEach(tagId => {
                const key = tagId.toString()
                if (counts[key] !== undefined) {
                    counts[key]++
                }
            })
        })
        return counts
    }, [tags, templates])

    const filteredTemplates = useMemo(() => {
        return templates.filter((template) => {
            const matchesSearch =
                template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                template.description.toLowerCase().includes(searchQuery.toLowerCase())

            const matchesTags =
                selectedTags.size === 0 ||
                template.tags.some((tagId) => selectedTags.has(tagId.toString()))

            return matchesSearch && matchesTags
        })
    }, [templates, searchQuery, selectedTags])

    const tagColorStyles = [
        "bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100",
        "bg-green-100 text-green-800 border-green-200 hover:bg-green-100",
        "bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-100",
        "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100",
        "bg-rose-100 text-rose-800 border-rose-200 hover:bg-rose-100",
        "bg-cyan-100 text-cyan-800 border-cyan-200 hover:bg-cyan-100",
        "bg-indigo-100 text-indigo-800 border-indigo-200 hover:bg-indigo-100",
        "bg-pink-100 text-pink-800 border-pink-200 hover:bg-pink-100",
        "bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-100",
        "bg-teal-100 text-teal-800 border-teal-200 hover:bg-teal-100",
    ]

    const getTagClass = (tagId: number) => {
        return tagColorStyles[tagId % tagColorStyles.length]
    }

    return (
        <div className="space-y-6">
            <FilterWorkspace label="Grid filters" search={<><Input
                            placeholder="Search reports..."
                            className="h-8 w-[150px] lg:w-[250px]"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        /></>} onClear={()=>{setSearchQuery('');setSelectedTags(new Set())}} filters={<FilterFields>
<FacetedFilter
                        title="Tags"
                        options={tagOptions}
                        selectedValues={selectedTags}
                        onSelect={setSelectedTags}
                        counts={tagCounts}
                    />
</FilterFields>}>
<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredTemplates.map((template) => (
                    <Link key={template.reportTemplateId} href={`/analytics/reports/${template.uid || template.reportTemplateId}`} className="block h-full">
                        <Card className="flex flex-col h-full hover:shadow-md transition-shadow cursor-pointer">
                            <CardHeader className="pb-3">
                                <div className="flex items-start justify-between gap-2">
                                    <CardTitle className="text-base font-semibold leading-tight">{template.name}</CardTitle>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        {template.hasWebPreview && (
                                            <Badge variant="secondary" className="text-[10px] px-1.5 h-5 bg-green-100 text-green-800 border-green-200">
                                                Live
                                            </Badge>
                                        )}
                                        <div className="p-1.5 bg-primary/10 rounded-md">
                                            <FileText className="h-4 w-4 text-primary" />
                                        </div>
                                    </div>
                                </div>
                                <CardDescription className="text-xs text-muted-foreground">
                                    {template.packName}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="flex-1 pb-3">
                                <p className="text-sm text-muted-foreground line-clamp-3" title={template.description}>
                                    {template.description}
                                </p>
                            </CardContent>
                            <CardFooter className="pt-0">
                                <div className="flex flex-wrap gap-1">
                                    {template.tags.slice(0, 3).map((tagId) => (
                                        <Badge
                                            key={tagId}
                                            variant="outline"
                                            className={`text-[10px] px-1.5 h-5 ${getTagClass(tagId)}`}
                                        >
                                            {tagMap[tagId] || tagId}
                                        </Badge>
                                    ))}
                                    {template.tags.length > 3 && (
                                        <Badge variant="secondary" className="text-[10px] px-1.5 h-5">
                                            +{template.tags.length - 3}
                                        </Badge>
                                    )}
                                </div>
                            </CardFooter>
                        </Card>
                    </Link>
                ))}
            </div>
{filteredTemplates.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                    No reports found matching your criteria.
                </div>
            )}
</FilterWorkspace></div>
    )
}
