"use client"

import { ArrowRight, Database, LayoutDashboard, ListChecks, ShieldCheck } from "lucide-react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useThemeConfig } from "@/components/active-theme"
import { useSidebar } from "@/components/ui/sidebar"
import { useSectionNames } from "@/lib/context/section-names-context"
import { Panel } from "@/components/investigation/shared"
import { THEMES } from "@/lib/themes"
import { cn } from "@/lib/utils"
import styles from "./branding.module.css"

export function ThemePreview() {
    const { theme } = useThemeConfig()
    const { open } = useSidebar()
    const { sectionNames } = useSectionNames()
    const name = THEMES.find(preset => preset.value === theme.preset)?.name || "Default"
    return <Panel title="Live preview" subtitle={`${name} · your current appearance, applied instantly.`} action={<span className={styles.sampleTag}>EXAMPLE DATA</span>}>
        <div className={styles.previewBody}>
            <div className={styles.previewShell} aria-label="Sample operations console">
                <div className={cn(styles.previewNav, !open && styles.previewNavCollapsed)} aria-label="Sample navigation">
                    <div className={styles.previewBrand}><ShieldCheck size={18} />{open && "Backup UI"}</div>
                    {open && <div className={styles.navLabel}>{sectionNames.vbr}</div>}
                    <div className={cn(styles.navItem, styles.navActive)}><LayoutDashboard size={14} />{open && "Overview"}</div>
                    <div className={styles.navItem}><ListChecks size={14} />{open && "Jobs"}</div>
                    <div className={styles.navItem}><Database size={14} />{open && "Storage"}</div>
                </div>
                <div className={cn(styles.previewContent, theme.contentLayout === "centered" && styles.previewCentered)}>
                    <div className={styles.previewTitle}><div><h3>Protection overview</h3><p>A clear picture of today&apos;s operations</p></div><ShieldCheck size={20} className="text-primary" /></div>
                    <div className={styles.previewMetrics}>
                        <div className={styles.previewMetric}><span>Protected workloads</span><strong>138</strong><small>Across 12 jobs</small></div>
                        <div className={styles.previewMetric}><span>Successful sessions</span><strong>98.4<small>%</small></strong><small>Last 24 hours</small></div>
                    </div>
                    <div className={styles.capacity}><div><span>Repository capacity</span><strong>72%</strong></div><div className={styles.capacityBar}><span /></div><p>7.2 TB used of 10 TB</p></div>
                    <div className={styles.previewTable}>
                        <table aria-label="Sample job results"><thead><tr><th scope="col">Protection job</th><th scope="col">Last result</th></tr></thead><tbody>
                            <tr><td>Daily virtual machines</td><td><Badge variant="success">Success</Badge></td></tr>
                            <tr><td>Off-site copy</td><td><Badge variant="warning">Warning</Badge></td></tr>
                            <tr><td>Database backup</td><td><Badge variant="destructive">Failed</Badge></td></tr>
                        </tbody></table>
                    </div>
                    <div className={styles.previewActions}><Button asChild size="sm"><Link href="/vbr/lens/overview">Open Overview <ArrowRight size={13} /></Link></Button><Button asChild size="sm" variant="outline"><Link href="/vbr/lens/operations">Job operations</Link></Button></div>
                </div>
            </div>
            <div className={styles.palette} aria-label="Current palette">
                {[['Background', '--background'], ['Surface', '--card'], ['Brand', '--primary'], ['Chart', '--chart-2']].map(([label, token]) => <div key={label}><span style={{ background: `var(${token})` }} /><p>{label}</p></div>)}
            </div>
            <p className={styles.previewNote}>Illustrative data only. Theme, color, font, density, and corner changes also apply to the application around this preview.</p>
        </div>
    </Panel>
}
