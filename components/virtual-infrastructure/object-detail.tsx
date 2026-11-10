"use client"
// Open Backup UI v1.2.0

import { useI18n } from "@/components/providers/i18n-provider"
import { inventoryDiagnostic, virtualContextLabel } from '@/lib/protected-data/presentation'
import { useDisplayFormat } from "@/components/providers/use-display-format"

import Link from 'next/link'
import { ArrowUpRight, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Empty, Panel } from '@/components/investigation/shared'
import { backupKey, canQuickBackup, isHost, isManager, isVm, memberVms, type VirtualRow } from '@/lib/virtual-infrastructure/model'
import { cn } from '@/lib/utils'
import { copy, Coverage, Protection } from './shared'
import ops from '@/components/operations/operations.module.css'
import styles from './virtual-operations.module.css'

export function ObjectDetail({row,rows,onClose,onScope,onQuick}:{row:VirtualRow;rows:VirtualRow[];onClose:()=>void;onScope:(r:VirtualRow)=>void;onQuick:()=>void}) {
  const { t, formatNumber } = useI18n()
  const { label: displayLabel, bytes: formatBytes } = useDisplayFormat()
  const vm=isVm(row.item), members=memberVms(row,rows)
  const entries=[['Platform',row.item.platform],['Object type',row.item.type],['vCenter / server',virtualContextLabel(t,row,'manager')],['Datacenter',virtualContextLabel(t,row,'datacenter')],['Cluster',virtualContextLabel(t,row,'cluster')],['Host',virtualContextLabel(t,row,'host')],['DNS name',virtualContextLabel(t,row,'dns')],['Guest OS',virtualContextLabel(t,row,'os')],['State',row.power],['Reported size',row.item.size],['Object ID',row.item.objectId],['URN',row.item.urn]]
  return <Dialog open onOpenChange={open=>{if(!open)onClose()}}><DialogContent className={cn(ops.console,styles.dialog)}><DialogHeader><div className={ops.eyebrow}>{t("Virtual Infrastructure / Object Details")}</div><DialogTitle>{row.item.name || t("Unnamed object")}</DialogTitle><DialogDescription>{t("Production inventory and backup evidence from the connected source.")}</DialogDescription></DialogHeader>
    <div className={styles.detailActions}>{vm && <Protection row={row}/>}<Button variant="outline" size="sm" disabled={!row.item.objectId} onClick={()=>copy(row.item.objectId!,t)}><Copy size={13}/>{t("Copy Object ID")}</Button><Button variant="outline" size="sm" disabled={!row.item.urn} onClick={()=>copy(row.item.urn!,t)}>{t("Copy URN")}</Button>{canQuickBackup(row.item) && <Button variant="outline" size="sm" onClick={onQuick}>{t("Quick Backup…")}</Button>}{(isManager(row.item)||isHost(row.item)||['Cluster','Datacenter'].includes(row.item.type||'')) && <Button variant="outline" size="sm" disabled={!members.length} onClick={()=>onScope(row)}>{t("View VMs")}</Button>}</div>
    <Panel title={t("Production context")} subtitle={t("Size and metadata retain the values reported by the inventory API.")}><dl>{entries.map(([label,value])=><div key={label}><dt>{t(label!)}</dt><dd>{["State","Object type","Platform"].includes(label!) ? displayLabel(value || "Not reported") : value || t("Not reported")}</dd></div>)}</dl>
      {row.item.isEnabled!==null && row.item.isEnabled!==undefined && <p className={ops.panelFoot}>{t("Inventory enabled flag:")}{" "}{row.item.isEnabled ? t('Yes'):t('No')}. {row.item.powerState ? t("Power state: {state}.",{state:displayLabel(row.item.powerState)}):t("No explicit powerState was reported; the enabled flag is shown separately from known VM power states.")}</p>}
    </Panel>
    {vm ? <Panel title={t("Backup evidence")} subtitle={inventoryDiagnostic(t,row.protectionNote,formatNumber)}>{row.backups.length ? row.backups.map(b=><div className={styles.evidence} key={backupKey(b)}><div><strong>{b.name || b.id}</strong><Link className={ops.textLink} href={`/vbr/protected-data/restore-points?objectId=${encodeURIComponent(b.id)}&name=${encodeURIComponent(b.name || row.item.name || '')}`}>{t("Explore restore points")}<ArrowUpRight size={13}/></Link></div><p>{t("{count} restore points",{count:b.restorePointsCount==null?t("Unknown"):formatNumber(b.restorePointsCount)})} · {b.size==null ? t("Size not reported"):formatBytes(b.size)} · {b.lastRunFailed===true ? t("Last run failed"):b.lastRunFailed===false ? t("Last run not failed"):t("Last-run result not reported")}</p><small>{b.path || t("Backup path not reported")}  · {t("Backup {backup} · Object {object}",{backup:b.backupId || t("Not reported"),object:b.id})}</small></div>):<Empty>{row.protection==='Unknown' ? t("Protection cannot be determined from the available evidence."):t("No matching backup objects found.")}</Empty>}<p className={ops.panelFoot}>{t("Restore points and sizes are per backup object; copies may overlap. A backup match does not prove current job coverage or recovery readiness.")}</p></Panel>
      : <Panel title={t("VM protection in this scope")} subtitle={t("Membership follows relationships returned in the production inventory.")}><div className={styles.evidence}><Coverage rows={members}/></div><p className={ops.panelFoot}>{members.length ? t("{count} linked VMs with a failed last backup run.",{count:formatNumber(members.filter(r=>r.backupIssue).length)}):t("VM membership and protection cannot be established for this object from the returned relationships.")} {" "}{t("Host and vCenter availability are not established by inventory presence.")}</p></Panel>}
    <Panel title={t("Inventory metadata")} subtitle={t("All metadata fields returned for this object.")}>{row.item.metadata?.length ? <dl>{row.item.metadata.map((m,i)=><div key={i}><dt>{m.field || t("Unnamed field")}</dt><dd>{m.data ?? t("Not reported")}</dd></div>)}</dl>:<Empty>{t("No metadata reported.")}</Empty>}</Panel>
  </DialogContent></Dialog>
}
