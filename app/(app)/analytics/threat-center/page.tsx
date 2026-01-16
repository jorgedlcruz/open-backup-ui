
import { ShieldAlert } from "lucide-react"

export default function ThreatCenterPage() {
    return (
        <div className="flex flex-col items-center justify-center h-[80vh] space-y-6 lg:p-6 p-4 text-center">
            <div className="p-4 bg-muted/50 rounded-full">
                <ShieldAlert className="h-12 w-12 text-muted-foreground" />
            </div>
            <div>
                <h2 className="text-2xl font-bold tracking-tight">Threat Center</h2>
                <p className="text-muted-foreground mt-2">
                    Advanced threat monitoring and analysis coming soon.
                </p>
            </div>
        </div>
    )
}
