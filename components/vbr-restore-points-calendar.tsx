"use client"
// Open Backup UI v1.2.0
import { useRecoveryPresentation } from '@/components/restore-points/use-presentation'

import { useState } from 'react'
import { addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { pointTime, type PointEvidence } from '@/lib/restore-points/model'
import styles from '@/components/restore-points/restore-points.module.css'

export function VBRRestorePointsCalendar({ data, onInspect, showWorkload = false }: { data: PointEvidence[]; onInspect: (id: string) => void; showWorkload?: boolean }) {
  const { t, formatNumber, formatDate, label } = useRecoveryPresentation()
  const dated = data.filter(row => pointTime(row.point) !== null);
  const [current, setCurrent] = useState(() => new Date(dated.length ? pointTime(dated[0].point)! : Date.now()));
  const [view, setView] = useState<'month' | 'week' | 'day'>('month');
  const navigate = (direction: number) => setCurrent(date => view === 'month' ? addMonths(date, direction) : view === 'week' ? addWeeks(date, direction) : addDays(date, direction));
  const days = view === 'day' ? [current] : eachDayOfInterval(view === 'month'
    ? { start: startOfWeek(startOfMonth(current)), end: endOfWeek(endOfMonth(current)) }
    : { start: startOfWeek(current), end: endOfWeek(current) });
  const title = view === 'month' ? formatDate(current, { month: 'long', year: 'numeric' }) : view === 'day' ? formatDate(current, { month: 'long', day: 'numeric', year: 'numeric' }) : `${formatDate(days[0], { month: 'short', day: 'numeric' })} – ${formatDate(days[6], { month: 'short', day: 'numeric', year: 'numeric' })}`;
  return <div className={styles.calendar}>
    <div className={styles.calendarToolbar}><div><Button variant="outline" size="icon-sm" aria-label={t("Previous calendar period")} onClick={() => navigate(-1)}><ChevronLeft size={14} /></Button><Button variant="outline" size="icon-sm" aria-label={t("Next calendar period")} onClick={() => navigate(1)}><ChevronRight size={14} /></Button><Button variant="ghost" size="sm" onClick={() => setCurrent(new Date())}>{t("Today")}</Button></div><h3>{title}</h3><select aria-label={t("Calendar view")} value={view} onChange={event => setView(event.target.value as typeof view)}><option value="month">{t("Month")}</option><option value="week">{t("Week")}</option><option value="day">{t("Day")}</option></select></div>
    {dated.length !== data.length && <p className="mb-3 text-xs text-muted-foreground">{t('{count} points have unknown dates. Inspect them in List view.', { count: formatNumber(data.length - dated.length) })}</p>}
    <div className={styles.calendarScroll}><div className={styles.calendarGrid} data-view={view}>
      {view !== 'day' && Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(current), index)).map(day => <div key={day.toISOString()} className={styles.calendarWeekday}>{formatDate(day, { weekday: 'short' })}</div>)}
      {days.map(day => {
        const points = dated.filter(row => isSameDay(new Date(pointTime(row.point)!), day));
        const shown = view === 'day' ? points : points.slice(0, 3);
        return <div className={styles.calendarDay} data-outside={view === 'month' && !isSameMonth(current, day)} data-today={isToday(day)} key={day.toISOString()}>
          <span>{formatDate(day, view === 'day' ? { weekday: 'long', month: 'long', day: 'numeric' } : { day: 'numeric' })}{points.length ? ` · ${t('{count} points', { count: formatNumber(points.length) })}` : ''}</span>
          {shown.map(row => <button key={row.point.id} className={styles.calendarPoint} data-flagged={row.flagged} onClick={() => onInspect(row.point.id)} aria-label={t('Inspect recovery point {id}', { id: row.point.id })}>
            {formatDate(pointTime(row.point)!, { hour: '2-digit', minute: '2-digit' })} · {label(row.type)}<small>{row.flagged ? t("Security review") : row.point.malwareStatus === 'Clean' ? t("Reported clean") : row.point.malwareStatus ? label(row.point.malwareStatus) : t("Malware unknown")}</small>{showWorkload && <small>{row.point.name || t("Unknown workload")}</small>}
          </button>)}
          {points.length > shown.length && <button className={styles.calendarMore} onClick={() => { setCurrent(day); setView('day'); }}>{t('+{count} more', { count: formatNumber(points.length - shown.length) })}</button>}
        </div>;
      })}
    </div></div>
  </div>;
}
