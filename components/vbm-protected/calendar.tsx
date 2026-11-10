'use client'
// Open Backup UI v1.2.0

import { useVbmPresentation } from '@/components/vbm-jobs/presentation'
import { Fragment,useState } from 'react'
import { addDays,addMonths,addWeeks,startOfMonth,startOfWeek,endOfMonth,endOfWeek,eachDayOfInterval,isSameDay,isSameMonth } from 'date-fns'
import { ChevronLeft,ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { time } from '@/lib/investigation/model'
import { content,copyKind,pointState,pointKey,type Point,type Detail } from '@/lib/vbm-protected/model'
import { cn } from '@/lib/utils'
import styles from './calendar.module.css'

export function Calendar({rows,data,onSelect}:{rows:Point[];data:Detail;onSelect:(point:Point)=>void}) {
  const {t,formatNumber,formatDate,localLabel,localLookup}=useVbmPresentation()



  const [view,setView]=useState('month'),[anchor,setAnchor]=useState(()=>new Date())
  const dated=rows.filter(point=>time(point.backupTime)!==null),days=view==='month' ? eachDayOfInterval({start:startOfWeek(startOfMonth(anchor)),end:endOfWeek(endOfMonth(anchor))}):view==='week' ? eachDayOfInterval({start:startOfWeek(anchor),end:endOfWeek(anchor)}):[anchor]
  const byDay=(day:Date)=>dated.filter(point=>isSameDay(new Date(point.backupTime!),day)).sort((a,b)=>time(b.backupTime)!-time(a.backupTime)!)
  function move(direction:number) {setAnchor(view==='month' ? addMonths(anchor,direction):view==='week' ? addWeeks(anchor,direction):addDays(anchor,direction))}
  const card=(point:Point)=><button key={pointKey(point)} className={styles.card} onClick={()=>onSelect(point)}><strong>{formatDate(point.backupTime!,{timeStyle:'medium'})} · {localLabel(copyKind(point))}</strong><span>{content(point).join(' / ') || t('Content not reported')} · {localLabel(pointState(point))}</span><small>{localLookup(data.jobs.data,point.jobId)}<br/>{localLookup(data.repositories.data,point.repositoryId)}</small></button>
  return <><div className={styles.toolbar}><strong>{view==='month' ? formatDate(anchor,{month:'long',year:'numeric'}):view==='week' ? `${formatDate(days[0],{day:'numeric',month:'short'})} – ${formatDate(days[6],{day:'numeric',month:'short',year:'numeric'})}`:formatDate(anchor,{dateStyle:'full'})}</strong><Button size="sm" variant="outline" onClick={()=>setAnchor(new Date())}>{t('Today')}</Button><Button size="icon" variant="ghost" aria-label={t('Previous calendar period')} onClick={()=>move(-1)}><ChevronLeft size={14}/></Button><Button size="icon" variant="ghost" aria-label={t('Next calendar period')} onClick={()=>move(1)}><ChevronRight size={14}/></Button><select aria-label={t('Calendar view')} value={view} onChange={event=>setView(event.target.value)}><option value="month">{t('Month')}</option><option value="week">{t('Week')}</option><option value="day">{t('Day')}</option></select><span>{t('Local time · {count} dated points',{count:formatNumber(dated.length)})}{rows.length!==dated.length && ` · ${t('{count} undated points in Grid',{count:formatNumber(rows.length-dated.length)})}`}</span></div><div className={styles.scroll}>{view==='month' ? <div className={styles.month}>{Array.from({length:7},(_,index)=><strong key={index}>{formatDate(addDays(startOfWeek(anchor),index),{weekday:'short'})}</strong>)}{days.map(day=>{const points=byDay(day);return <div key={day.toISOString()} className={!isSameMonth(day,anchor) ? styles.outside:''}><button className={styles.date} aria-label={t('Show {date}',{date:formatDate(day,{dateStyle:'long'})})} onClick={()=>{setAnchor(day);setView('day')}}>{formatDate(day,{day:'numeric'})}{isSameDay(day,new Date()) ? ` · ${t('Today')}`:''}</button>{points.slice(0,2).map(card)}{points.length>2 && <button className={styles.more} onClick={()=>{setAnchor(day);setView('day')}}>{t('+ {count} more',{count:formatNumber(points.length-2)})}</button>}</div>})}</div>:<div className={cn(styles.hourGrid,view==='day' && styles.day)} style={{gridTemplateColumns:`55px repeat(${days.length},minmax(110px,1fr))`}}><strong>{t('Time')}</strong>{days.map(day=><strong key={day.toISOString()}>{formatDate(day,{weekday:'short',day:'numeric',month:'short'})}</strong>)}{Array.from({length:24},(_,hour)=><Fragment key={hour}><div>{formatDate(new Date(2000,0,1,hour),{hour:'2-digit',minute:'2-digit'})}</div>{days.map(day=><div key={day.toISOString()}>{byDay(day).filter(point=>new Date(point.backupTime!).getHours()===hour).map(card)}</div>)}</Fragment>)}</div>}</div></>
}
