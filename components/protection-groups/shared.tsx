"use client"

import Link from 'next/link'
import { ArrowUpRight, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Status, date } from '@/components/investigation/shared'
import { recordStatus } from '@/lib/investigation/model'
import { componentTone, statusLabel, type DiscoveredEntity, type GroupRow, type ProtectionGroup } from '@/lib/protection-groups/model'
import { cn } from '@/lib/utils'
import ops from '@/components/operations/operations.module.css'
import styles from './protection-operations.module.css'

export function Badge({ value, tone }: { value?: string | null; tone?: 'neutral' | 'danger' | 'warning' | 'success' | 'active' }) {
  return <span className={cn(ops.badge, ops[tone || componentTone(value)])}><span className={ops.dot} />{statusLabel(value)}</span>
}
export const flag = (v?: boolean | null) => v === true ? 'Enabled' : v === false ? 'Disabled' : 'Not reported'
export function Enabled({ group }: { group: ProtectionGroup }) { return <Badge value={group.isDisabled === true ? 'Disabled' : group.isDisabled === false ? 'Enabled' : 'Not reported'} tone={group.isDisabled === true ? 'warning' : 'neutral'} /> }
export type ActionKind = 'rescan' | 'enable' | 'disable' | 'installAgent' | 'uninstallAgent'
export type Action = { group: ProtectionGroup; entity?: DiscoveredEntity; kind: ActionKind }
export const actionNames: Record<ActionKind,string> = {rescan:'Rescan',enable:'Enable group',disable:'Disable group',installAgent:'Install agent',uninstallAgent:'Uninstall agent'}
export function Actions({ group, entity, onAction }: { group: ProtectionGroup; entity?: DiscoveredEntity; onAction: (action: Action) => void }) {
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${entity?.name || group.name}`}><MoreHorizontal size={17}/></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
    <DropdownMenuItem onSelect={() => onAction({group,entity,kind:'rescan'})}>Rescan</DropdownMenuItem>
    {!entity && group.isDisabled === true && <DropdownMenuItem onSelect={() => onAction({group,kind:'enable'})}>Enable group</DropdownMenuItem>}
    {!entity && group.isDisabled === false && <DropdownMenuItem onSelect={() => onAction({group,kind:'disable'})}>Disable group</DropdownMenuItem>}
    {entity?.type === 'Computer' && entity.agentStatus === 'NotInstalled' && <DropdownMenuItem onSelect={() => onAction({group,entity,kind:'installAgent'})}>Install agent</DropdownMenuItem>}
    {entity?.type === 'Computer' && ['Installed','UpgradeRequired'].includes(entity.agentStatus || '') && <DropdownMenuItem className="text-destructive" onSelect={() => onAction({group,entity,kind:'uninstallAgent'})}>Uninstall agent</DropdownMenuItem>}
  </DropdownMenuContent></DropdownMenu>
}
export function Discovery({ row }: { row: GroupRow }) {
  const latest = row.sessions[0]
  return <div className={styles.stack}>{latest ? <><Link className={ops.textLink} href={`/vbr/sessions/${latest.id}`}><Status value={recordStatus(latest)}/><ArrowUpRight size={13}/></Link><small>{date(latest.creationTime)}</small></> : <span className={styles.muted}>{row.historyComplete ? 'No linked run in 30 days' : 'History unavailable / partial'}</span>}</div>
}
