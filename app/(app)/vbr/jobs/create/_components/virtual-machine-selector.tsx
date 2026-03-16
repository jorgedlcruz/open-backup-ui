import { useState, useEffect } from "react"
import { veeamApi } from "@/lib/api/veeam-client"
import { VeeamInventoryItem } from "@/lib/types/veeam"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Loader2, Search, Server, Layers, Box, CheckCircle2 } from "lucide-react"

interface VirtualMachineSelectorProps {
    platform?: string
    selectedVMs: VeeamInventoryItem[]
    onSelectionChange: (vms: VeeamInventoryItem[]) => void
}

export function VirtualMachineSelector({ platform, selectedVMs, onSelectionChange }: VirtualMachineSelectorProps) {
    const [searchTerm, setSearchTerm] = useState("")
    const [inventory, setInventory] = useState<VeeamInventoryItem[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        // Debounce search
        const timer = setTimeout(() => {
            if (searchTerm.length >= 2) {
                fetchInventory(searchTerm)
            } else if (searchTerm.length === 0) {
                // Fetch default top level
                fetchInventory()
            }
        }, 500)

        return () => clearTimeout(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchTerm])

    const fetchInventory = async (query?: string) => {
        try {
            setLoading(true)
            setError(null)

            const items = await veeamApi.getInventory({ nameFilter: query })

            // Build platform aliases so 'vmware' matches items with platform='vSphere', etc.
            const platformAliases: Record<string, string[]> = {
                vmware: ['vsphere', 'vmware', 'vcenter'],
                hyperv: ['hyperv', 'hyper-v', 'scvmm'],
            }
            const normalizedPlatform = platform?.toLowerCase()
            const allowedPlatforms = normalizedPlatform
                ? (platformAliases[normalizedPlatform] ?? [normalizedPlatform])
                : null

            setInventory(items.filter(i =>
                ['VirtualMachine', 'VirtualApp', 'ResourcePool', 'HostSystem', 'ClusterComputeResource', 'Datacenter', 'Folder'].includes(i.type) &&
                (!allowedPlatforms || !i.platform || allowedPlatforms.some(p => i.platform.toLowerCase().includes(p)))
            ))

        } catch (err) {
            console.error(err)
            setError("Failed to load inventory.")
        } finally {
            setLoading(false)
        }
    }

    const toggleSelection = (item: VeeamInventoryItem) => {
        const isSelected = selectedVMs.some(v => v.objectId === item.objectId)
        if (isSelected) {
            onSelectionChange(selectedVMs.filter(v => v.objectId !== item.objectId))
        } else {
            onSelectionChange([...selectedVMs, item])
        }
    }

    const getIconForType = (type: string) => {
        switch (type) {
            case 'VirtualMachine': return <Server className="h-4 w-4 text-blue-500" />
            case 'ClusterComputeResource':
            case 'ResourcePool': return <Layers className="h-4 w-4 text-purple-500" />
            case 'Datacenter':
            case 'Folder': return <Box className="h-4 w-4 text-orange-500" />
            default: return <Server className="h-4 w-4 text-gray-500" />
        }
    }

    return (
        <div className="space-y-4">
            <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search for virtual machines or containers (min 2 chars)..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Search Results */}
                <div className="border rounded-md">
                    <div className="bg-muted px-4 py-2 font-medium text-sm border-b flex justify-between">
                        <span>Inventory</span>
                        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>
                    <ScrollArea className="h-[300px]">
                        {error ? (
                            <div className="p-4 text-center text-sm text-red-500">{error}</div>
                        ) : inventory.length === 0 && !loading ? (
                            <div className="text-center p-4 text-muted-foreground text-sm">
                                {searchTerm.length < 2 ? "Type to search..." : "No items found."}
                            </div>
                        ) : (
                            <div className="p-2 space-y-1">
                                {inventory.map((item) => {
                                    const isSelected = selectedVMs.some(v => v.objectId === item.objectId)
                                    return (
                                        <div
                                            key={item.objectId}
                                            onClick={() => toggleSelection(item)}
                                            className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${isSelected ? 'bg-primary/10 hover:bg-primary/20' : 'hover:bg-muted'}`}
                                        >
                                            <div className="flex items-center space-x-3">
                                                {getIconForType(item.type)}
                                                <div>
                                                    <div className="text-sm font-medium">{item.name}</div>
                                                    <div className="text-xs text-muted-foreground">{item.type} • {item.hostName}</div>
                                                </div>
                                            </div>
                                            {isSelected && <CheckCircle2 className="h-4 w-4 text-primary" />}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </ScrollArea>
                </div>

                {/* Selected Items */}
                <div className="border rounded-md">
                    <div className="bg-muted px-4 py-2 font-medium text-sm border-b flex justify-between items-center">
                        <span>Selected to Backup</span>
                        <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full">{selectedVMs.length}</span>
                    </div>
                    <ScrollArea className="h-[300px]">
                        {selectedVMs.length === 0 ? (
                            <div className="text-center p-4 text-muted-foreground text-sm flex flex-col items-center justify-center h-full">
                                <Box className="h-8 w-8 mb-2 opacity-20" />
                                <span>No items selected</span>
                            </div>
                        ) : (
                            <div className="p-2 space-y-1">
                                {selectedVMs.map((item) => (
                                    <div
                                        key={`sel-${item.objectId}`}
                                        className="flex items-center justify-between p-2 rounded border bg-card"
                                    >
                                        <div className="flex items-center space-x-3">
                                            {getIconForType(item.type)}
                                            <div>
                                                <div className="text-sm font-medium">{item.name}</div>
                                                <div className="text-xs text-muted-foreground">{item.type}</div>
                                            </div>
                                        </div>
                                        <Button variant="ghost" size="sm" onClick={() => toggleSelection(item)} className="text-red-500 hover:text-red-600 hover:bg-red-50">
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
