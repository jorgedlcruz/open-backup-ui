import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"

export interface ScheduleConfig {
    applicationAwareProcessing: boolean
    guestOsCredentialsId: string // For future use
    enableSchedule: boolean
    dailyTime: string
    dailyType: 'Everyday' | 'Workdays' | 'Weekends'
}

interface ScheduleSelectorProps {
    value: ScheduleConfig
    onChange: (config: ScheduleConfig) => void
}

export function ScheduleSelector({ value, onChange }: ScheduleSelectorProps) {

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Guest Processing */}
                <div className="space-y-4">
                    <h3 className="text-lg font-medium border-b pb-2">Guest Processing</h3>

                    <div className="space-y-4 p-4 border rounded-md bg-card">
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label className="text-base">Enable application-aware processing</Label>
                                <p className="text-xs text-muted-foreground">Creates transactionally consistent backups</p>
                            </div>
                            <Switch
                                checked={value.applicationAwareProcessing}
                                onCheckedChange={(checked) => onChange({ ...value, applicationAwareProcessing: checked })}
                            />
                        </div>

                        {value.applicationAwareProcessing && (
                            <div className="pt-2 border-t mt-2">
                                <Label className="text-muted-foreground text-sm">Guest OS Credentials</Label>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Selecting specific credentials is not yet supported in Open Backup UI.
                                    The default job credentials will be used if configured on the server.
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Schedule */}
                <div className="space-y-4">
                    <h3 className="text-lg font-medium border-b pb-2">Schedule</h3>

                    <div className="space-y-4 p-4 border rounded-md bg-card">
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label className="text-base">Run the job automatically</Label>
                            </div>
                            <Switch
                                checked={value.enableSchedule}
                                onCheckedChange={(checked) => onChange({ ...value, enableSchedule: checked })}
                            />
                        </div>

                        {value.enableSchedule && (
                            <div className="space-y-4 pt-4 border-t mt-4">
                                <div className="space-y-2">
                                    <Label>Run Time</Label>
                                    <Input
                                        type="time"
                                        value={value.dailyTime}
                                        onChange={(e) => onChange({ ...value, dailyTime: e.target.value })}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label>Run Days</Label>
                                    <Select
                                        value={value.dailyType}
                                        onValueChange={(val: ScheduleConfig['dailyType']) => onChange({ ...value, dailyType: val })}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select Frequency" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Everyday">Everyday</SelectItem>
                                            <SelectItem value="Workdays">Workdays (Mon-Fri)</SelectItem>
                                            <SelectItem value="Weekends">Weekends (Sat-Sun)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    )
}
