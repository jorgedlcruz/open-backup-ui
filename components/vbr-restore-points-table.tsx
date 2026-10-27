"use client"

import { useState } from 'react'
import { SortableGrid } from '@/components/ui/sortable-grid'
import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatBytes, isFlagged, pointTime, type PointEvidence } from '@/lib/restore-points/model'
import { cn } from '@/lib/utils'
import ops from '@/components/operations/operations.module.css'
import styles from '@/components/restore-points/restore-points.module.css'

export function VBRRestorePointsTable({ data, onInspect, showWorkload = false }: { data: PointEvidence[]; onInspect: (id: string) => void; showWorkload?: boolean }) {
  // Bind pagination to the actual result set so filter changes cannot strand a user on an empty page.
  const key = data.map(row => row.point.id).join('|');
  const [pagination, setPagination] = useState({ key, page: 0 });
  const pages = Math.max(1, Math.ceil(data.length / 10));
  const page = pagination.key === key ? Math.min(pagination.page, pages - 1) : 0;
  const changePage = (next: number) => setPagination({ key, page: next });
  return <>
    <div className={ops.tableScroll}><SortableGrid rows={data} columns={[{id:'created',value:r=>pointTime(r.point),kind:'date'},{id:'type',value:r=>r.type},{id:'malware',value:r=>r.point.malwareStatus},{id:'job',value:r=>r.backup?.name},{id:'size',value:r=>r.file?.backupSize}]} onSortChange={()=>changePage(0)}>{(data)=>(<table className={ops.table}>
      <thead><tr><th>Recovery point</th><th>Type / retention</th><th>Malware status</th><th>Job / destination</th><th>Whole-file size</th><th><span className="sr-only">Inspect point</span></th></tr></thead>
      <tbody>{data.slice(page * 10, page * 10 + 10).map(row => {
        const timestamp = pointTime(row.point);
        const flaggedFile = isFlagged(row.file?.severity);
        return <tr key={row.point.id}>
          <td><button className={styles.dateButton} onClick={() => onInspect(row.point.id)} aria-label={`Inspect recovery point ${row.point.id}`}>
            {timestamp === null ? 'Unknown date' : new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
            <span className={styles.cellSub}>{timestamp === null ? 'Date not reported' : new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            {showWorkload && <span className={styles.cellSub}>{row.point.name || 'Unknown workload'}</span>}
          </button></td>
          <td><span className={ops.badge} title={row.typeSource}>{row.type}</span><span className={styles.cellSub}>{row.typeSource.startsWith('Inferred') ? 'File extension · ' : ''}{row.gfs.length ? row.gfs.join(' · ') : row.gfsSource === 'Not reported' ? 'GFS unknown' : 'No GFS flags'}</span></td>
          <td><span className={cn(ops.badge, row.flagged ? ops.danger : row.point.malwareStatus === 'Clean' ? ops.success : ops.neutral)}><span className={ops.dot} />{flaggedFile && !isFlagged(row.point.malwareStatus) ? 'File flagged' : row.point.malwareStatus === 'Clean' ? 'Reported clean' : row.point.malwareStatus || 'Unknown'}</span></td>
          <td className={styles.job}>{row.backup?.name || 'Unknown job'}<span className={styles.cellSub}>{row.backup?.repositoryName || row.backup?.repositoryId || 'Unknown repository'}</span></td>
          <td className={styles.numeric}>{formatBytes(row.file?.backupSize)}<span className={cn(styles.cellSub, styles.fileHint)} title={row.file?.name || undefined}>{!row.file ? row.mapping === 'ambiguous' ? 'Ambiguous mapping' : 'No file mapping' : (row.file.objectIds?.length || 0) > 1 || (row.file.restorePointIds?.length || 0) > 1 ? 'Shared file' : 'File-level observation'}</span></td>
          <td><button className={ops.inspect} onClick={() => onInspect(row.point.id)} aria-label={`Open evidence for ${row.point.id}`}><ArrowUpRight size={17} /></button></td>
        </tr>;
      })}</tbody>
    </table>)}</SortableGrid></div>
    <div className={ops.pagination}><span>{page * 10 + 1}–{Math.min((page + 1) * 10, data.length)} of {data.length} points</span><div><Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={!page} onClick={() => changePage(page - 1)}><ChevronLeft size={15} /></Button><span>{page + 1} / {pages}</span><Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= pages - 1} onClick={() => changePage(page + 1)}><ChevronRight size={15} /></Button></div></div>
  </>;
}
