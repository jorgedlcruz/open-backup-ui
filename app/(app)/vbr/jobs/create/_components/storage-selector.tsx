import { useState, useEffect } from "react"
import { VeeamProxy, VeeamRepository } from "@/lib/types/veeam"
import { veeamApi } from "@/lib/api/veeam-client"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Loader2, HardDrive, Network } from "lucide-react"

export interface StorageConfig {
    repositoryId: string
    proxyId: string // 'auto' or specific GUID
    retentionDays: number
    syntheticFullsEnabled: boolean
    syntheticFullsDays: string[]
    activeFullsEnabled: boolean
    activeFullsDays: string[]
}

interface StorageSelectorProps {
    value: StorageConfig
    onChange: (config: StorageConfig) => void
}

export function StorageSelector({ value, onChange }: StorageSelectorProps) {
    const [repositories, setRepositories] = useState<VeeamRepository[]>([])
    const [proxies, setProxies] = useState<VeeamProxy[]>([])
    const [loadingRepos, setLoadingRepos] = useState(true)
    const [loadingProxies, setLoadingProxies] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const fetchInfrastructure = async () => {
            try {
                // Fetch Repositories
                const repos = await veeamApi.getRepositories()
                setRepositories(repos)
                // Auto-select first repo if none selected
                if (repos.length > 0 && !value.repositoryId) {
                    onChange({ ...value, repositoryId: repos[0].id })
                }
                setLoadingRepos(false)

                // Fetch Proxies
                const proxies = await veeamApi.getBackupProxies()
                setProxies(proxies)
                setLoadingProxies(false)
            } catch (err) {
                console.error("Failed to load infrastructure", err)
                setError("Failed to load backup infrastructure map.")
                setLoadingRepos(false)
                setLoadingProxies(false)
            }
        }

        fetchInfrastructure()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

    const toggleDay = (target: 'synthetic' | 'active', day: string) => {
        if (target === 'synthetic') {
            const days = value.syntheticFullsDays.includes(day)
                ? value.syntheticFullsDays.filter(d => d !== day)
                : [...value.syntheticFullsDays, day]
            onChange({ ...value, syntheticFullsDays: days })
        } else {
            const days = value.activeFullsDays.includes(day)
                ? value.activeFullsDays.filter(d => d !== day)
                : [...value.activeFullsDays, day]
            onChange({ ...value, activeFullsDays: days })
        }
    }

    if (error) {
        return <div className="p-4 text-center text-red-500 bg-red-50 rounded-md border border-red-200">{error}</div>
    }

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Infrastructure Selection */}
                <div className="space-y-4">
                    <h3 className="text-lg font-medium border-b pb-2">Infrastructure</h3>

                    <div className="space-y-2">
                        <Label htmlFor="repository" className="flex items-center">
                            <HardDrive className="h-4 w-4 mr-2" />
                            Backup Repository <span className="text-red-500 ml-1">*</span>
                        </Label>
                        {loadingRepos ? (
                            <div className="flex items-center h-10 px-3 border rounded-md bg-muted/50 text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading repositories...
                            </div>
                        ) : (
                            <Select value={value.repositoryId} onValueChange={(val) => onChange({ ...value, repositoryId: val })}>
                                <SelectTrigger id="repository">
                                    <SelectValue placeholder="Select Backup Repository" />
                                </SelectTrigger>
                                <SelectContent>
                                    {repositories.map(repo => (
                                        <SelectItem key={repo.id} value={repo.id}>
                                            {repo.name} ({repo.type})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="proxy" className="flex items-center">
                            <Network className="h-4 w-4 mr-2" />
                            Backup Proxy
                        </Label>
                        {loadingProxies ? (
                            <div className="flex items-center h-10 px-3 border rounded-md bg-muted/50 text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading proxies...
                            </div>
                        ) : (
                            <Select value={value.proxyId} onValueChange={(val) => onChange({ ...value, proxyId: val })}>
                                <SelectTrigger id="proxy">
                                    <SelectValue placeholder="Automatic Selection" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="auto">Automatic Selection</SelectItem>
                                    {proxies.map(proxy => (
                                        <SelectItem key={proxy.id} value={proxy.id}>
                                            {proxy.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                </div>

                {/* Retention and Advanced */}
                <div className="space-y-4">
                    <h3 className="text-lg font-medium border-b pb-2">Retention Policy</h3>

                    <div className="space-y-2">
                        <Label htmlFor="retention">Keep restore points (Days) <span className="text-red-500 ml-1">*</span></Label>
                        <Input
                            id="retention"
                            type="number"
                            min={1}
                            max={999}
                            value={value.retentionDays}
                            onChange={(e) => onChange({ ...value, retentionDays: parseInt(e.target.value) || 7 })}
                        />
                    </div>

                    <div className="space-y-4 pt-4">
                        <h4 className="font-medium text-sm text-muted-foreground">Advanced Settings</h4>

                        <div className="space-y-3 p-4 border rounded-md bg-card">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label>Create synthetic full backups</Label>
                                    <p className="text-xs text-muted-foreground">Periodically synthesize full backups from increments</p>
                                </div>
                                <Switch
                                    checked={value.syntheticFullsEnabled}
                                    onCheckedChange={(checked) => onChange({ ...value, syntheticFullsEnabled: checked })}
                                />
                            </div>

                            {value.syntheticFullsEnabled && (
                                <div className="flex flex-wrap gap-2 pt-2">
                                    {daysOfWeek.map(day => (
                                        <div
                                            key={`synth-${day}`}
                                            onClick={() => toggleDay('synthetic', day)}
                                            className={`text-xs px-2 py-1 rounded-md cursor-pointer capitalize border transition-colors ${value.syntheticFullsDays.includes(day) ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted hover:bg-muted/80'}`}
                                        >
                                            {day.substring(0, 3)}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="space-y-3 p-4 border rounded-md bg-card">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label>Create active full backups</Label>
                                    <p className="text-xs text-muted-foreground">Periodically run a full backup</p>
                                </div>
                                <Switch
                                    checked={value.activeFullsEnabled}
                                    onCheckedChange={(checked) => onChange({ ...value, activeFullsEnabled: checked })}
                                />
                            </div>

                            {value.activeFullsEnabled && (
                                <div className="flex flex-wrap gap-2 pt-2">
                                    {daysOfWeek.map(day => (
                                        <div
                                            key={`active-${day}`}
                                            onClick={() => toggleDay('active', day)}
                                            className={`text-xs px-2 py-1 rounded-md cursor-pointer capitalize border transition-colors ${value.activeFullsDays.includes(day) ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted hover:bg-muted/80'}`}
                                        >
                                            {day.substring(0, 3)}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                    </div>
                </div>
            </div>
        </div>
    )
}
