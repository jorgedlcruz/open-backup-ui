"use client"

import { useState } from 'react'
import { addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { pointTime, type PointEvidence } from '@/lib/restore-points/model'
import styles from '@/components/restore-points/restore-points.module.css'

export function VBRRestorePointsCalendar({ data, onInspect, showWorkload = false }: { data: PointEvidence[]; onInspect: (id: string) => void; showWorkload?: boolean }) {
  const dated = data.filter(row => pointTime(row.point) !== null);
  const [current, setCurrent] = useState(() => new Date(dated.length ? pointTime(dated[0].point)! : Date.now()));
  const [view, setView] = useState<'month' | 'week' | 'day'>('month');
  const navigate = (direction: number) => setCurrent(date => view === 'month' ? addMonths(date, direction) : view === 'week' ? addWeeks(date, direction) : addDays(date, direction));
  const days = view === 'day' ? [current] : eachDayOfInterval(view === 'month'
    ? { start: startOfWeek(startOfMonth(current)), end: endOfWeek(endOfMonth(current)) }
    : { start: startOfWeek(current), end: endOfWeek(current) });
  const title = view === 'month' ? format(current, 'MMMM yyyy') : view === 'day' ? format(current, 'MMMM d, yyyy') : `${format(days[0], 'MMM d')} – ${format(days[6], 'MMM d, yyyy')}`;
  return <div className={styles.calendar}>
    <div className={styles.calendarToolbar}><div><Button variant="outline" size="icon-sm" aria-label="Previous calendar period" onClick={() => navigate(-1)}><ChevronLeft size={14} /></Button><Button variant="outline" size="icon-sm" aria-label="Next calendar period" onClick={() => navigate(1)}><ChevronRight size={14} /></Button><Button variant="ghost" size="sm" onClick={() => setCurrent(new Date())}>Today</Button></div><h3>{title}</h3><select aria-label="Calendar view" value={view} onChange={event => setView(event.target.value as typeof view)}><option value="month">Month</option><option value="week">Week</option><option value="day">Day</option></select></div>
    {dated.length !== data.length && <p className="mb-3 text-xs text-muted-foreground">{data.length - dated.length} points have unknown dates. Inspect them in List view.</p>}
    <div className={styles.calendarScroll}><div className={styles.calendarGrid} data-view={view}>
      {view !== 'day' && ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <div key={day} className={styles.calendarWeekday}>{day}</div>)}
      {days.map(day => {
        const points = dated.filter(row => isSameDay(new Date(pointTime(row.point)!), day));
        const shown = view === 'day' ? points : points.slice(0, 3);
        return <div className={styles.calendarDay} data-outside={view === 'month' && !isSameMonth(current, day)} data-today={isToday(day)} key={day.toISOString()}>
          <span>{format(day, view === 'day' ? 'EEEE, MMMM d' : 'd')}{points.length ? ` · ${points.length} points` : ''}</span>
          {shown.map(row => <button key={row.point.id} className={styles.calendarPoint} data-flagged={row.flagged} onClick={() => onInspect(row.point.id)} aria-label={`Inspect recovery point ${row.point.id}`}>
            {format(new Date(pointTime(row.point)!), 'HH:mm')} · {row.type}<small>{row.flagged ? 'Security review' : row.point.malwareStatus === 'Clean' ? 'Reported clean' : row.point.malwareStatus || 'Malware unknown'}</small>{showWorkload && <small>{row.point.name || 'Unknown workload'}</small>}
          </button>)}
          {points.length > shown.length && <button className={styles.calendarMore} onClick={() => { setCurrent(day); setView('day'); }}>+{points.length - shown.length} more</button>}
        </div>;
      })}
    </div></div>
  </div>;
}
