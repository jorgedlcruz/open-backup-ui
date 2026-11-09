// Open Backup UI v1.0.2
import {
  Activity, Boxes, CalendarClock, ChartArea, ChartBar, ChartLine, ChartPie,
  ClipboardCheck, DatabaseBackup, Files, Gauge, HardDrive, History, KeyRound,
  LayoutDashboard, LayoutGrid, Radar, Server, ServerCog, ShieldAlert, ShieldCheck,
  SquareActivity, Table2, TrendingUp, createLucideIcon, type LucideIcon,
} from 'lucide-react'
import type { SourceId, ViewId } from '@/lib/labs/model'

// Match the rest of the console, with one stable identity per source across the
// picker, inspector, cards and public viewer. These identify data, not its health.
const sourceIcons = {
  protected: DatabaseBackup,
  objects: Boxes,
  history: History,
  jobs: Activity,
  malware: ShieldAlert,
  repositories: HardDrive,
  security: ShieldCheck,
  forecast: TrendingUp,
  runway: Gauge,
  footprint: Files,
  retention: CalendarClock,
  hygiene: ClipboardCheck,
  overview: LayoutDashboard,
  proxies: ServerCog,
  servers: Server,
  licenses: KeyRound,
} satisfies Record<SourceId, LucideIcon>

// Lucide's Donut represents food. Use a segmented ring in the same 24px grid
// and stroke system so this control describes the chart it will create.
const ChartDonut = createLucideIcon('ChartDonut', [
  ['circle', { cx: '12', cy: '12', r: '9', key: 'outer' }],
  ['circle', { cx: '12', cy: '12', r: '4', key: 'inner' }],
  ['path', { d: 'M12 3v5m4 4h5', key: 'segments' }],
])

const viewIcons = {
  grid: LayoutGrid,
  table: Table2,
  donut: ChartDonut,
  pie: ChartPie,
  bar: ChartBar,
  line: ChartLine,
  area: ChartArea,
  kpi: SquareActivity,
  treemap: LayoutDashboard,
  radar: Radar,
} satisfies Record<ViewId, LucideIcon>

type IconStyle = { size?: number; className?: string }
export function SourceIcon({ source, size = 20, className }: IconStyle & { source: SourceId }) {
  const Icon = sourceIcons[source]
  return <Icon size={size} strokeWidth={1.75} className={className} aria-hidden="true" focusable="false" />
}

export function ViewIcon({ view, size = 20, className }: IconStyle & { view: ViewId }) {
  const Icon = viewIcons[view]
  return <Icon size={size} strokeWidth={1.75} className={className} aria-hidden="true" focusable="false" />
}
