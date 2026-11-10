"use client"
// Open Backup UI v1.0.2
import { useRecoveryPresentation } from '@/components/restore-points/use-presentation'

import { useState } from 'react'
import { SortableGrid } from '@/components/ui/sortable-grid'
import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isFlagged, pointTime, type PointEvidence } from '@/lib/restore-points/model'
import { cn } from '@/lib/utils'
import ops from '@/components/operations/operations.module.css'
import styles from '@/components/restore-points/restore-points.module.css'

type PointPicker = {
  checked: (row: PointEvidence) => boolean
  available: (row: PointEvidence) => boolean
  toggle: (row: PointEvidence) => void
}

export function VBRRestorePointsTable({ data, onInspect, showWorkload = false, picker }: {
  data: PointEvidence[]; onInspect: (id: string) => void; showWorkload?: boolean; picker?: PointPicker
}) {
  const { t, formatNumber, formatDate, label, size } = useRecoveryPresentation()
  // Bind pagination to the actual result set so filter changes cannot strand a user on an empty page.
  const key = data.map(row => row.point.id).join('|');
  const [pagination, setPagination] = useState({ key, page: 0 });
  const pages = Math.max(1, Math.ceil(data.length / 10));
  const page = pagination.key === key ? Math.min(pagination.page, pages - 1) : 0;
  const changePage = (next: number) => setPagination({ key, page: next });
  return <>
    <div className={ops.tableScroll}><SortableGrid rows={data} columns={[...(picker ? [null] : []),{id:'created',value:r=>pointTime(r.point),kind:'date'},{id:'type',value:r=>r.type},{id:'malware',value:r=>r.point.malwareStatus},{id:'job',value:r=>r.backup?.name},{id:'size',value:r=>r.file?.backupSize}]} onSortChange={()=>changePage(0)}>{(data)=>(<table className={ops.table}>
      <thead><tr>{picker && <th><span className="sr-only">{t('Select')}</span></th>}<th>{t("Recovery point")}</th><th>{t("Type / retention")}</th><th>{t("Malware status")}</th><th>{t("Job / destination")}</th><th>{t("Whole-file size")}</th><th><span className="sr-only">{t("Inspect point")}</span></th></tr></thead>
      <tbody>{data.slice(page * 10, page * 10 + 10).map(row => {
        const timestamp = pointTime(row.point);
        const flaggedFile = isFlagged(row.file?.severity);
        return <tr key={row.point.id}>
          {picker && <td><input type="checkbox" className="accent-primary" aria-label={t('Select recovery point for {name} at {date}',{name:row.point.name || row.point.id,date:timestamp === null ? t('Unknown') : formatDate(timestamp)})}
            checked={picker.checked(row)} disabled={!picker.available(row)} onChange={() => picker.toggle(row)}/></td>}
          <td><button className={styles.dateButton} onClick={() => onInspect(row.point.id)} aria-label={t('Inspect recovery point {id}', { id: row.point.id })}>
            {timestamp === null ? t("Unknown date") : formatDate(timestamp, { month: 'short', day: 'numeric', year: 'numeric' })}
            <span className={styles.cellSub}>{timestamp === null ? t("Date not reported") : formatDate(timestamp, { hour: '2-digit', minute: '2-digit' })}</span>
            {showWorkload && <span className={styles.cellSub}>{row.point.name || t("Unknown workload")}</span>}
          </button></td>
          <td><span className={ops.badge} title={label(row.typeSource)}>{label(row.type)}</span><span className={styles.cellSub}>{row.typeSource.startsWith('Inferred') ? (t("File extension ·") + " ") : ''}{row.gfs.length ? row.gfs.map(label).join(' · ') : row.gfsSource === 'Not reported' ? t("GFS unknown") : t("No GFS flags")}</span></td>
          <td><span className={cn(ops.badge, row.flagged ? ops.danger : row.point.malwareStatus === 'Clean' ? ops.success : ops.neutral)}><span className={ops.dot} />{flaggedFile && !isFlagged(row.point.malwareStatus) ? t("File flagged") : row.point.malwareStatus === 'Clean' ? t("Reported clean") : row.point.malwareStatus ? label(row.point.malwareStatus) : t("Unknown")}</span></td>
          <td className={styles.job}>{row.backup?.name || t("Unknown job")}<span className={styles.cellSub}>{row.backup?.repositoryName || row.backup?.repositoryId || t("Unknown repository")}</span></td>
          <td className={styles.numeric}>{size(row.file?.backupSize)}<span className={cn(styles.cellSub, styles.fileHint)} title={row.file?.name || undefined}>{!row.file ? row.mapping === 'ambiguous' ? t("Ambiguous mapping") : t("No file mapping") : (row.file.objectIds?.length || 0) > 1 || (row.file.restorePointIds?.length || 0) > 1 ? t("Shared file") : t("File-level observation")}</span></td>
          <td><button className={ops.inspect} onClick={() => onInspect(row.point.id)} aria-label={t('Open evidence for {id}', { id: row.point.id })}><ArrowUpRight size={17} /></button></td>
        </tr>;
      })}</tbody>
    </table>)}</SortableGrid></div>
    <div className={ops.pagination}><span>{t('{start}–{end} of {count} points', { start: formatNumber(data.length ? page * 10 + 1 : 0), end: formatNumber(Math.min((page + 1) * 10, data.length)), count: formatNumber(data.length) })}</span><div><Button variant="ghost" size="icon-sm" aria-label={t("Previous page")} disabled={!page} onClick={() => changePage(page - 1)}><ChevronLeft size={15} /></Button><span>{formatNumber(page + 1)} / {formatNumber(pages)}</span><Button variant="ghost" size="icon-sm" aria-label={t("Next page")} disabled={page >= pages - 1} onClick={() => changePage(page + 1)}><ChevronRight size={15} /></Button></div></div>
  </>;
}
