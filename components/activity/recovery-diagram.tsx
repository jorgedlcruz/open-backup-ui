'use client'
// Open Backup UI v1.2.0

import { useId, type HTMLAttributes, type ReactNode } from 'react'
import { ArrowDownToLine, Ban, Box, Check, ChevronRight, CircleHelp, Clock3, Database, Network, Plus, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import styles from './instant-recovery-workspace.module.css'

export type RecoveryPhase = 'checking' | 'accepted' | 'active' | 'completed' | 'warning' | 'failed' | 'canceled' | 'unknown'
export type RecoveryFact = {label: string; value: ReactNode; icon?: LucideIcon; primary?: boolean}

const transferIcons: Record<RecoveryPhase, LucideIcon> = {
  checking:Clock3, accepted:Clock3, active:ArrowDownToLine, completed:Check,
  warning:TriangleAlert, failed:X, canceled:Ban, unknown:CircleHelp,
}

export function RecoveryHostArt({production, proxy, phase, available}: {production?: boolean; proxy?: boolean; phase?: RecoveryPhase; available?: boolean}) {
  const empty = production && !phase && available
  const Icon = proxy ? Network : phase ? transferIcons[phase] : empty ? Plus : Box
  return <span aria-hidden="true" className={styles.hostArt} data-production={production || undefined}>
    <span className={styles.machineBadge} data-empty={empty || undefined}><Icon/></span>
    <span className={styles.uplink}/>
    <span className={styles.chassis}>
      <span className={styles.serverUnit}><i/><b/></span><span className={styles.serverUnit}><i/><b/></span>
    </span>
  </span>
}

function RepositoryArt() {
  return <span aria-hidden="true" className={styles.repositoryArt}><i/><i/><i/><span><Database size={15}/></span></span>
}

export function RecoveryDiagram({label, nodes, editing, footer, children}: {
  label: string; nodes: number; editing?: boolean; footer?: ReactNode; children: ReactNode
}) {
  return <section aria-label={label} className={styles.workspace}>
    <div className={styles.canvas} data-nodes={nodes} data-editing={editing || undefined}>{children}</div>
    {footer}
  </section>
}

type NodeProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  kind: 'repository' | 'machine' | 'proxy' | 'destination'; label: string; name?: string; facts?: RecoveryFact[]
  phase?: RecoveryPhase; available?: boolean; editing?: boolean; artwork?: ReactNode; status?: ReactNode
}

export function RecoveryNode({kind, label, name, facts, phase, artwork, status, available, editing, children, ...props}: NodeProps) {
  const labelId = useId()
  return <div {...props} role="group" aria-labelledby={labelId} className={styles[kind === 'proxy' ? 'machine' : kind]} data-node={kind} data-phase={phase}
    data-enabled={available || undefined} data-configuring={editing || undefined}>
    {!editing && (artwork ?? <div className={styles.art}>{kind === 'repository' ? <RepositoryArt/> :
      <RecoveryHostArt production={kind === 'destination'} proxy={kind === 'proxy'} phase={phase} available={available}/>}</div>)}
    <div className={styles.identity}><span className={styles.role} id={labelId}>{label}</span>{name && <strong>{name}</strong>}</div>
    {status}
    {!!facts?.length && <dl className={styles.facts}>{facts.map(({label, value, icon:Icon, primary}) =>
      <div key={label}><dt>{Icon && <Icon aria-hidden/>}{label}</dt><dd className={primary ? styles.primaryDatastore : undefined}>{value}</dd></div>)}</dl>}
    {children}
  </div>
}

export function RecoveryConnector({phase, label, mounted, io, measurement}: {phase?: RecoveryPhase; label?: string; mounted?: boolean; io?: 'read'|'write'; measurement?:{label:string;value:string}}) {
  return <div className={styles.connection} data-phase={phase} data-mounted={mounted || undefined} data-transfer={!mounted || undefined} data-io={io}>
    <div className={styles.rail} aria-hidden="true"><span className={styles.strand}>{phase === 'active' && <><i/><i/></>}</span><ChevronRight className={styles.arrow}/></div>
    {measurement && <span className={styles.linkMeasure} data-migration-speed title={measurement.label}>
      <small>{measurement.label}</small><strong>{measurement.value}</strong></span>}
    {label && <span className={styles.linkLabel}>{label}</span>}
  </div>
}
