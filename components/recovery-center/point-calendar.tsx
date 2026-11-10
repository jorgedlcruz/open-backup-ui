'use client'
// Open Backup UI v1.0.2
import {useEffect,useRef,useState} from 'react'
import {addDays,eachDayOfInterval,endOfMonth,endOfWeek,format,isSameMonth,isToday,parseISO,startOfMonth,startOfWeek} from 'date-fns'
import {CalendarDays,Check,ChevronLeft,ChevronRight,Clock3} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {pointTime,type RestorePoint} from '@/lib/restore-points/model'
import type {CalendarDay,PickerPage,PickerScope,RecoveryObject} from '@/lib/restore-points/recovery-picker'
import {RecoverySignal} from '../restore-points/recovery-signal'
import {useRecoveryPresentation} from '../restore-points/use-presentation'
import styles from './point-calendar.module.css'

const pageSize=40
const undated='undated'
function dayOf(point:RestorePoint){
  const time=pointTime(point)
  return time===null?undated:format(time,'yyyy-MM-dd')
}
const samePoint=(a:RestorePoint|undefined,b:RestorePoint)=>a?.id===b.id&&a.backupId===b.backupId
type Reader=(sourceKey:string,kind:PickerScope,view:'points',args:Record<string,string>,signal:AbortSignal)=>Promise<PickerPage<RestorePoint>>

export function PointCalendar({object,selected,sourceKey,kind,read,choose}:{
  object:RecoveryObject;selected?:RestorePoint;sourceKey:string;kind:PickerScope;read:Reader;choose:(point:RestorePoint)=>void
}){
  const {t,formatDate,formatNumber,label,diagnostic}=useRecoveryPresentation()
  const [query,setQuery]=useState(()=>({day:selected?dayOf(selected):undefined as string|undefined,offset:0,revision:0}))
  const [days,setDays]=useState<CalendarDay[]>(),[page,setPage]=useState<PickerPage<RestorePoint>>(),[error,setError]=useState('')
  const hasIndex=useRef(false),retried=useRef(0)
  const backupId=object.copies.length===1?object.copies[0].backupId:undefined
  useEffect(()=>{
    const ctrl=new AbortController(),refresh=query.revision!==retried.current
    retried.current=query.revision
    const args={objectId:object.objectId,...(backupId&&{backupId}),limit:String(pageSize),offset:String(query.offset),
      calendarZone:Intl.DateTimeFormat().resolvedOptions().timeZone,...(query.day&&{calendarDay:query.day}),
      ...(!hasIndex.current||refresh?{calendarIndex:'true'}:{}),...(refresh&&{refresh:'true'})}
    setPage(undefined);setError('')
    read(sourceKey,kind,'points',args,ctrl.signal).then(result=>{
      if(ctrl.signal.aborted)return
      if(result.calendarDays){hasIndex.current=true;setDays(result.calendarDays)}
      setPage(result)
    }).catch(e=>{if(!ctrl.signal.aborted)setError(e.message)})
    return()=>ctrl.abort()
  },[sourceKey,kind,read,object.objectId,backupId,query])

  const navigate=(day:string,offset=0)=>{setPage(undefined);setQuery(current=>({...current,day,offset}))}
  const retry=()=>setQuery(current=>({...current,offset:0,revision:current.revision+1}))
  const notices=page&&!page.complete?<div className={styles.notice} role="status">{t('The restore-point list is partial.')}
    <Button type="button" size="sm" variant="outline" onClick={retry}>{t('Retry')}</Button></div>:null
  if(!days&&!error)return <RecoverySignal stage="data" compact/>
  if(!days?.length)return error?<div role="alert">{diagnostic(error)} <Button type="button" onClick={retry}>{t('Retry')}</Button></div>
    :<div>{page?.complete&&<p role="status">{t('No eligible restore points for this workload.')}</p>}{notices}</div>

  const counts=new Map(days.map(d=>[d.day,d.count]))
  const dated=days.map(d=>d.day).filter(day=>day!==undated).sort().reverse()
  const activeDay=query.day||page?.calendarDay||dated[0]||undated
  const viewed=activeDay===undated?dated[0]:activeDay
  const current=viewed?parseISO(viewed):null
  const months=[...new Set(dated.map(day=>day.slice(0,7)))].sort()
  const years=[...new Set(months.map(month=>month.slice(0,4)))].reverse()
  const month=viewed?.slice(0,7)||'',year=month.slice(0,4),monthIndex=months.indexOf(month)
  const openMonth=(value:string|undefined)=>{const day=value&&dated.find(d=>d.startsWith(value+'-'));if(day)navigate(day)}
  const openYear=(value:string)=>openMonth(months.includes(value+month.slice(4))?value+month.slice(4):months.filter(m=>m.startsWith(value+'-')).at(-1))
  const cells=current?eachDayOfInterval({start:startOfWeek(startOfMonth(current)),end:endOfWeek(endOfMonth(current))}):[]
  const shown=page?.data||[]
  const pinned=selected&&dayOf(selected)===activeDay&&!shown.some(p=>samePoint(selected,p))&&page&&page.total>pageSize&&query.offset===0?selected:undefined
  const points=pinned?[pinned,...shown]:shown
  const copyLabel=(point:RestorePoint)=>{
    const copy=object.copies.find(c=>c.backupId===point.backupId)
    if(!copy?.name)return point.backupId
    return object.copies.some(c=>c.backupId!==point.backupId&&c.name===copy.name)?copy.name+' · '+point.backupId:copy.name
  }
  return <section className={styles.panel} aria-label={t('Restore point calendar')+' · '+object.name}>
    <div className={styles.calendar}><h4><CalendarDays size={15}/>{t('Restore point calendar')} <span>· {object.name}</span></h4>
      {current&&<><div className={styles.toolbar}>
        <button type="button" aria-label={t('Previous calendar period')} disabled={monthIndex<=0} onClick={()=>openMonth(months[monthIndex-1])}><ChevronLeft size={16}/></button>
        <select aria-label={t('Month')} value={month} onChange={e=>openMonth(e.target.value)}>{months.filter(m=>m.startsWith(year+'-')).map(m=><option value={m} key={m}>{formatDate(parseISO(m+'-01'),{month:'long'})}</option>)}</select>
        <select aria-label={t('Year')} value={year} onChange={e=>openYear(e.target.value)}>{years.map(y=><option key={y} value={y}>{formatDate(parseISO(y+'-01-01'),{year:'numeric'})}</option>)}</select>
        <button type="button" aria-label={t('Next calendar period')} disabled={monthIndex<0||monthIndex>=months.length-1} onClick={()=>openMonth(months[monthIndex+1])}><ChevronRight size={16}/></button>
      </div>
      <div className={styles.grid}>
        {Array.from({length:7},(_,i)=>addDays(startOfWeek(current),i)).map(d=><abbr title={formatDate(d,{weekday:'long'})} key={d.getDay()}>{formatDate(d,{weekday:'narrow'})}</abbr>)}
        {cells.map(date=>{
          const key=format(date,'yyyy-MM-dd'),count=counts.get(key)||0
          if(!isSameMonth(current,date))return <span key={key}/>
          const accessible=formatDate(date,{weekday:'long',day:'numeric',month:'long',year:'numeric'})
          return <button type="button" key={key} disabled={!count} aria-pressed={activeDay===key} aria-current={isToday(date)?'date':undefined}
            aria-label={accessible+(count?' · '+t('{count} points',{count:formatNumber(count)}):'')} onClick={()=>navigate(key)}>
            {formatNumber(date.getDate())}{!!count&&<i aria-hidden="true"/>}</button>
        })}
      </div></>}
      {counts.has(undated)&&<button type="button" className={styles.unknown} aria-pressed={activeDay===undated} onClick={()=>navigate(undated)}>{t('Unknown date')} · {formatNumber(counts.get(undated)!)}</button>}
    </div>
    <div className={styles.times}><h4><Clock3 size={15}/>{t('Restore times')}</h4>
      <p className={styles.dayTitle}>{activeDay===undated?t('Unknown date'):formatDate(parseISO(activeDay),{weekday:'short',day:'numeric',month:'long',year:'numeric'})}</p>
      {error?<div role="alert">{diagnostic(error)} <Button type="button" size="sm" onClick={retry}>{t('Retry')}</Button></div>:!page?<RecoverySignal stage="data" compact/>:
        <><div className={styles.slots}>{points.map(point=>{
          const time=pointTime(point),chosen=samePoint(selected,point)
          const duplicate=points.some(p=>p!==point&&p.backupId===point.backupId&&pointTime(p)===time&&p.type===point.type)
          return <button type="button" aria-pressed={chosen} title={point.id} key={point.id+'/'+point.backupId} onClick={()=>choose(point)}>
            <span><strong>{time===null?t('Unknown date'):formatDate(time,{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'})}</strong>
              <span>{label(point.type||'Unknown')} · {copyLabel(point)}{duplicate?' · '+point.id:''}</span></span>{chosen&&<Check size={16} aria-hidden="true"/>}</button>
        })}</div>
        {!!page.total&&page.total>pageSize&&<div className={styles.pager}><span>{t('{start}–{end} of {count}',{start:formatNumber(query.offset+1),end:formatNumber(query.offset+shown.length),count:formatNumber(page.total)})}</span>
          <Button type="button" size="icon-sm" variant="outline" aria-label={t('Previous')} disabled={!query.offset} onClick={()=>navigate(activeDay,Math.max(0,query.offset-pageSize))}><ChevronLeft size={15}/></Button>
          <Button type="button" size="icon-sm" variant="outline" aria-label={t('Next')} disabled={query.offset+shown.length>=page.total} onClick={()=>navigate(activeDay,query.offset+pageSize)}><ChevronRight size={15}/></Button></div>}
        {!points.length&&page.complete&&<p role="status">{t('No restore points')}</p>}
        {notices}</>}
    </div>
  </section>
}
