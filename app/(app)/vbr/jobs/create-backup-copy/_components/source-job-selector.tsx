import { useState, useEffect } from "react"
import { veeamApi } from "@/lib/api/veeam-client"
import { VeeamBackupJob } from "@/lib/types/veeam"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Loader2, Search, CheckCircle2, Copy } from "lucide-react"

interface SourceJobSelectorProps {
    selectedJobs: VeeamBackupJob[]
    onSelectionChange: (jobs: VeeamBackupJob[]) => void
}

export function SourceJobSelector({ selectedJobs, onSelectionChange }: SourceJobSelectorProps) {
    const [searchTerm, setSearchTerm] = useState("")
    const [jobs, setJobs] = useState<VeeamBackupJob[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        fetchSourceJobs()
    }, [])

    const fetchSourceJobs = async () => {
        try {
            setLoading(true)
            setError(null)
            const items = await veeamApi.getBackupCopySourceJobs()
            setJobs(items)
        } catch (err) {
            console.error(err)
            setError("Failed to load source jobs.")
        } finally {
            setLoading(false)
        }
    }

    const toggleSelection = (item: VeeamBackupJob) => {
        const isSelected = selectedJobs.some(j => j.id === item.id)
        if (isSelected) {
            onSelectionChange(selectedJobs.filter(j => j.id !== item.id))
        } else {
            onSelectionChange([...selectedJobs, item])
        }
    }

    // Filter by name locally
    const filteredJobs = jobs.filter(j =>
        j.name.toLowerCase().includes(searchTerm.toLowerCase())
    )

    return (
        <div className="space-y-4">
            <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search for source backup jobs..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Available Source Jobs */}
                <div className="border rounded-md shadow-sm bg-card overflow-hidden">
                    <div className="bg-muted/50 px-4 py-3 font-medium text-sm border-b flex justify-between items-center">
                        <span>Eligible Jobs</span>
                        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>
                    <ScrollArea className="h-[300px]">
                        {error ? (
                            <div className="p-4 text-center text-sm text-red-500">{error}</div>
                        ) : filteredJobs.length === 0 && !loading ? (
                            <div className="text-center p-8 text-muted-foreground text-sm flex flex-col items-center">
                                <Copy className="h-8 w-8 mb-3 opacity-20" />
                                <span>No eligible source jobs found.</span>
                            </div>
                        ) : (
                            <div className="p-2 space-y-1">
                                {filteredJobs.map((item) => {
                                    const isSelected = selectedJobs.some(j => j.id === item.id)
                                    return (
                                        <div
                                            key={item.id}
                                            onClick={() => toggleSelection(item)}
                                            className={`flex items-start justify-between p-3 rounded-md cursor-pointer transition-all ${isSelected ? 'bg-primary/10 border-primary/20 hover:bg-primary/20' : 'hover:bg-muted border border-transparent hover:border-border'}`}
                                        >
                                            <div className="flex items-start space-x-3">
                                                <div className="mt-0.5">
                                                    <Copy className={`h-4 w-4 ${isSelected ? 'text-primary' : 'text-blue-500'}`} />
                                                </div>
                                                <div>
                                                    <div className="text-sm font-medium leading-none mb-1.5">{item.name}</div>
                                                    <div className="text-xs text-muted-foreground flex items-center space-x-2">
                                                        <span>{item.type}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            {isSelected && <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </ScrollArea>
                </div>

                {/* Selected Items */}
                <div className="border rounded-md shadow-sm bg-card overflow-hidden">
                    <div className="bg-muted/50 px-4 py-3 font-medium text-sm border-b flex justify-between items-center">
                        <span>Selected Source Jobs</span>
                        <div className="flex items-center space-x-2">
                            <span className="bg-primary/10 text-primary text-xs font-semibold px-2 py-0.5 rounded-full">{selectedJobs.length}</span>
                        </div>
                    </div>
                    <ScrollArea className="h-[300px]">
                        {selectedJobs.length === 0 ? (
                            <div className="text-center p-8 text-muted-foreground text-sm flex flex-col items-center justify-center h-full">
                                <CheckCircle2 className="h-8 w-8 mb-3 opacity-20" />
                                <span>Select jobs from the list</span>
                            </div>
                        ) : (
                            <div className="p-2 space-y-2">
                                {selectedJobs.map((item) => (
                                    <div
                                        key={`sel-${item.id}`}
                                        className="flex items-start justify-between p-3 rounded-md border bg-background shadow-sm group"
                                    >
                                        <div className="flex items-start space-x-3">
                                            <div className="mt-0.5">
                                                <Copy className="h-4 w-4 text-primary" />
                                            </div>
                                            <div>
                                                <div className="text-sm font-medium leading-none mb-1.5">{item.name}</div>
                                                <div className="text-xs text-muted-foreground">{item.type}</div>
                                            </div>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => toggleSelection(item)}
                                            className="h-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 -mt-1 -mr-1"
                                        >
                                            Remove
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </ScrollArea>
                </div>
            </div>
        </div>
    )
}
