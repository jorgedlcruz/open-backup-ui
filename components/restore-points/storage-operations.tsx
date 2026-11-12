'use client'
// Open Backup UI v1.2.0
import {useId,useState} from 'react'
import {ArrowRight,Check,ChevronDown,ChevronRight,Copy,File,LoaderCircle,ListChecks,RotateCcw,TriangleAlert,X} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {finishedStorageTask,type StorageScope} from '@/lib/restore-points/unstructured-workspace'
import {activeStorageOperation,storageOperationProgress,storageOperationSummary,type StorageOperation} from '@/lib/restore-points/storage-operations'
import {useStorageOperations} from './use-storage-operations'
import {useRecoveryPresentation} from './use-presentation'
import styles from './storage-operations.module.css'

function OperationRow({operation,retry}:{operation:StorageOperation;retry:()=>void}){
  const {t,label,date,formatNumber,diagnostic}=useRecoveryPresentation(),[expanded,setExpanded]=useState(false),id=useId()
  const progress=storageOperationProgress(operation),active=activeStorageOperation(operation),snapshot=operation.snapshot
  const failed=operation.phase==='rejected'||!!snapshot&&finishedStorageTask(snapshot)==='failed'
  const attention=failed||operation.phase==='unknown'||!!operation.readError
  const state=failed?(snapshot?.result&&snapshot.result!=='None'?label(snapshot.result):t('Failed')):operation.readError?t('Status unavailable'):operation.phase==='unknown'?t('Status unconfirmed'):
    operation.phase==='submitting'?t('Checking with VBR'):snapshot?label(snapshot.result&&snapshot.result!=='None'&&!active?snapshot.result:snapshot.state):t('Checking with VBR')
  const logs=snapshot?.logs?.records||[]
  const target=operation.destination?.name||t('Original location')
  return <article className={styles.operation} data-attention={attention}>
    <button type="button" className={styles.row} onClick={()=>setExpanded(value=>!value)} aria-expanded={expanded} aria-controls={id}>
      <span className={styles.symbol}>{operation.action==='copy'?<Copy size={18}/>:<RotateCcw size={18}/>}</span>
      <span className={styles.identity}><strong>{operation.action==='copy'?t('Copy files'):t('Restore files')} <ArrowRight size={13}/>{target}</strong>
        <span>{operation.items.length?t('{count} items',{count:formatNumber(operation.items.length)}):t('Items not reported')}
          {operation.destination?.path&&<> · {operation.destination.path}</>}</span></span>
      <span className={styles.status} data-attention={attention}>{attention?<TriangleAlert size={14}/>:active?<LoaderCircle size={14} className={styles.spin}/>:<Check size={14}/>}{state}</span>
      <span className={styles.progress}>{progress===undefined?'—':formatNumber(progress)+'%'}{progress!==undefined&&<span className={styles.track}><span style={{width:progress+'%'}}/></span>}</span>
      {expanded?<ChevronDown size={15}/>:<ChevronRight size={15}/>}</button>
    {expanded&&<div id={id} className={styles.details}>
      <dl className={styles.facts}><div><dt>{t('Started')}</dt><dd>{date(snapshot?.creationTime||operation.createdAt)}</dd></div>
        {snapshot?.endTime&&<div><dt>{t('Ended')}</dt><dd>{date(snapshot.endTime)}</dd></div>}
        <div><dt>{t('Destination')}</dt><dd>{target}{operation.destination?.path&&<span>{operation.destination.path}</span>}</dd></div></dl>
      {operation.phase==='unknown'&&<p className={styles.warning}>{t('Check the operation status before submitting the same files again.')}</p>}
      {(operation.error||operation.readError)&&<p role="alert" className={styles.warning}>{diagnostic(operation.error||operation.readError||'')}</p>}
      {operation.persistError&&<p role="alert" className={styles.warning}>{t('Progress could not be saved in this browser. Keep this page open until the operation finishes.')}</p>}
      {(operation.readError||operation.phase==='unknown'||operation.phase==='submitting')&&<Button type="button" size="sm" variant="outline" onClick={retry}>{t('Check status')}</Button>}
      {operation.items.length>0&&<details className={styles.items}><summary><File size={14}/>{t('Selected items')} <span>{formatNumber(operation.items.length)}</span></summary>
        <ul>{operation.items.map(item=><li key={item.path+'|'+(item.version||'')}>{item.path}{item.version&&<small>{date(item.version)}</small>}</li>)}</ul></details>}
      <div className={styles.log}><h4>{t('Operation log')}{snapshot?.logs?.totalRecords!==undefined&&<span>{formatNumber(snapshot.logs.totalRecords)}</span>}</h4>
        {logs.length?<ol>{logs.map((log,index)=><li key={String(log.id)+'-'+index}>
          <span className={styles.logState}>{log.status?label(log.status):'—'}<small>{log.updateTime||log.startTime?date(log.updateTime||log.startTime):''}</small></span>
          <span><strong>{log.title||log.description||'—'}</strong>{log.description&&log.description!==log.title&&<span>{log.description}</span>}{log.additionalInfo?.map((entry,index)=><span key={entry.field+index}>{entry.field}: {entry.data}</span>)}</span>
        </li>)}</ol>:<p>{t('No operation log entries have been reported yet.')}</p>}
        {snapshot?.additionalInfo?.message&&<p>{snapshot.additionalInfo.message}</p>}</div>
    </div>}
  </article>
}

export function StorageOperationsPanel({operations,retry,onClose,id}:{operations:StorageOperation[];retry:()=>void;onClose?:()=>void;id?:string}){
  const {t,formatNumber}=useRecoveryPresentation(),summary=storageOperationSummary(operations)
  return <section id={id} className={styles.panel} aria-label={t('Operations')}>
    <header><div><ListChecks size={17}/><h3>{t('Operations')}</h3><span>{summary.active?t('{count} active',{count:formatNumber(summary.active)}):t('{count} operations',{count:formatNumber(operations.length)})}</span></div>
      {onClose&&<Button size="icon-sm" variant="ghost" aria-label={t('Collapse operations')} onClick={onClose}><X size={15}/></Button>}</header>
    {operations.length?<div className={styles.list}>{[...operations].reverse().map(row=><OperationRow key={row.requestId} operation={row} retry={retry}/>)}</div>:
      <p className={styles.empty}>{t('Copies and restores started here will appear here.')}</p>}
  </section>
}

export function StorageOperationsIndicator({operations,open,onClick,controls}:{operations:StorageOperation[];open:boolean;onClick:()=>void;controls:string}){
  const {t,formatNumber}=useRecoveryPresentation(),summary=storageOperationSummary(operations)
  const active=operations.filter(activeStorageOperation),progress=active.length===1?storageOperationProgress(active[0]):undefined
  return <Button size="sm" variant="outline" className={styles.indicator} onClick={onClick} aria-expanded={open} aria-controls={controls}>
    {summary.active?<LoaderCircle size={14} className={styles.spin}/>:summary.attention?<TriangleAlert size={14}/>:<ListChecks size={14}/>}
    {t('Operations')}<span className={styles.count}>{formatNumber(summary.active||operations.length)}</span>{progress!==undefined&&<span>{formatNumber(progress)}%</span>}
  </Button>
}

/** Read-only operation history survives the parent browse session being closed. */
export function StorageOperationsView({scope}:{scope:StorageScope}){
  const {operations,retry}=useStorageOperations(scope)
  return <StorageOperationsPanel operations={operations} retry={retry}/>
}
