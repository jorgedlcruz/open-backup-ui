"use client"

import Link from 'next/link'
import { ArrowUpRight, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Empty, Panel } from '@/components/investigation/shared'
import { backupKey, canQuickBackup, isHost, isManager, isVm, memberVms, type VirtualRow } from '@/lib/virtual-infrastructure/model'
import { formatBytes } from '@/lib/restore-points/model'
import { cn } from '@/lib/utils'
import { copy, Coverage, Protection } from './shared'
import ops from '@/components/operations/operations.module.css'
import styles from './virtual-operations.module.css'

export function ObjectDetail({row,rows,onClose,onScope,onQuick}:{row:VirtualRow;rows:VirtualRow[];onClose:()=>void;onScope:(r:VirtualRow)=>void;onQuick:()=>void}) {
  const vm=isVm(row.item), members=memberVms(row,rows)
  const entries=[['Platform',row.item.platform],['Object type',row.item.type],['vCenter / server',row.manager.name],['Datacenter',row.datacenter.name],['Cluster',row.cluster.name],['Host',row.host.name],['DNS name',row.dns],['Guest OS',row.os],['State',row.power],['Reported size',row.item.size],['Object ID',row.item.objectId],['URN',row.item.urn]]
  return <Dialog open onOpenChange={open=>{if(!open)onClose()}}><DialogContent className={cn(ops.console,styles.dialog)}><DialogHeader><div className={ops.eyebrow}>Virtual Infrastructure / Object Details</div><DialogTitle>{row.item.name || 'Unnamed object'}</DialogTitle><DialogDescription>Production inventory and backup evidence from the connected source.</DialogDescription></DialogHeader>
    <div className={styles.detailActions}>{vm && <Protection row={row}/>}<Button variant="outline" size="sm" disabled={!row.item.objectId} onClick={()=>copy(row.item.objectId!)}><Copy size={13}/>Copy Object ID</Button><Button variant="outline" size="sm" disabled={!row.item.urn} onClick={()=>copy(row.item.urn!)}>Copy URN</Button>{canQuickBackup(row.item) && <Button variant="outline" size="sm" onClick={onQuick}>Quick Backup…</Button>}{(isManager(row.item)||isHost(row.item)||['Cluster','Datacenter'].includes(row.item.type||'')) && <Button variant="outline" size="sm" disabled={!members.length} onClick={()=>onScope(row)}>View VMs</Button>}</div>
    <Panel title="Production context" subtitle="Size and metadata retain the values reported by the inventory API."><dl>{entries.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value || 'Not reported'}</dd></div>)}</dl>
      {row.item.isEnabled!==null && row.item.isEnabled!==undefined && <p className={ops.panelFoot}>Inventory enabled flag: {row.item.isEnabled ? 'true':'false'}. {row.item.powerState ? `Power state: ${row.item.powerState}.`:'No explicit powerState was reported; the enabled flag is shown separately from known VM power states.'}</p>}
    </Panel>
    {vm ? <Panel title="Backup evidence" subtitle={row.protectionNote}>{row.backups.length ? row.backups.map(b=><div className={styles.evidence} key={backupKey(b)}><div><strong>{b.name || b.id}</strong><Link className={ops.textLink} href={`/vbr/protected-data/restore-points?objectId=${encodeURIComponent(b.id)}&name=${encodeURIComponent(b.name || row.item.name || '')}`}>Explore restore points<ArrowUpRight size={13}/></Link></div><p>{b.restorePointsCount ?? 'Unknown'} restore points · {b.size==null ? 'Size not reported':formatBytes(b.size)} · {b.lastRunFailed===true ? 'Last run failed':b.lastRunFailed===false ? 'Last run not failed':'Last-run result not reported'}</p><small>{b.path || 'Backup path not reported'} · Backup {b.backupId || 'not reported'} · Object {b.id}</small></div>):<Empty>{row.protection==='Unknown' ? 'Protection cannot be determined from the available evidence.':'No matching backup objects found.'}</Empty>}<p className={ops.panelFoot}>Restore points and sizes are per backup object; copies may overlap. A backup match does not prove current job coverage or recovery readiness.</p></Panel>
      : <Panel title="VM protection in this scope" subtitle="Membership follows relationships returned in the production inventory."><div className={styles.evidence}><Coverage rows={members}/></div><p className={ops.panelFoot}>{members.length ? `${members.filter(r=>r.backupIssue).length} linked VMs with a failed last backup run.`:'VM membership and protection cannot be established for this object from the returned relationships.'} Host and vCenter availability are not established by inventory presence.</p></Panel>}
    <Panel title="Inventory metadata" subtitle="All metadata fields returned for this object.">{row.item.metadata?.length ? <dl>{row.item.metadata.map((m,i)=><div key={i}><dt>{m.field || 'Unnamed field'}</dt><dd>{m.data ?? 'Not reported'}</dd></div>)}</dl>:<Empty>No metadata reported.</Empty>}</Panel>
  </DialogContent></Dialog>
}
