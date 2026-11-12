'use client'
// Open Backup UI v1.2.0

import { useEffect, useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useI18n } from '@/components/providers/i18n-provider'
import type { ThroughputHistory, ThroughputSample } from '@/lib/activity/throughput'
import styles from './session-speed-chart.module.css'

type Series = {key:string; samples:ThroughputSample[]}
const width = 256, height = 46, inset = 5

function groupSamples(samples: ThroughputSample[]): Series[] {
  const series = new Map<string, Series>()
  for (const sample of samples) {
    if (!Number.isFinite(sample.at) || !Number.isFinite(sample.bytesPerSecond) || sample.bytesPerSecond < 0) continue
    const key = JSON.stringify([sample.basis, sample.taskId, sample.logId ?? sample.disk])
    const group = series.get(key)
    if (group) group.samples.push(sample)
    else series.set(key,{key, samples:[sample]})
  }
  for (const group of series.values()) group.samples.sort((a,b) => a.at - b.at)
  return [...series.values()]
}

function closestSample(samples: ThroughputSample[], at: number) {
  let low = 0, high = samples.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (samples[middle].at < at) low = middle + 1
    else high = middle
  }
  return low && at - samples[low - 1].at <= samples[low].at - at ? low - 1 : low
}

export function SessionSpeedChart({history, running, preferDisk}: {history?:ThroughputHistory; running:boolean; preferDisk?:boolean}) {
  const {t, formatNumber, formatDate} = useI18n()
  const fillId = useId()
  const [seriesKey, setSeriesKey] = useState('')
  const [cursorAt, setCursorAt] = useState<number>()
  const [expiredAt, setExpiredAt] = useState<number>()
  const groups = useMemo(() => groupSamples(history?.samples ?? []), [history?.samples])
  const expires = history?.expiresAt
  useEffect(() => {
    if (expires == null) return
    const timer = setTimeout(() => setExpiredAt(expires), Math.max(0, expires - Date.now()))
    return () => clearTimeout(timer)
  }, [expires])
  if (!history || expires != null && (expires === expiredAt || expires <= Date.now())) return null
  if (!groups.length) return running ? <figure className={styles.empty}>
    <figcaption>{t('Transfer speed')}</figcaption><span>{t('Awaiting speed data')}</span>
  </figure> : null

  // For a VM restore, the disk log is the rate displayed by VBR in the latest event.
  const disks = preferDisk ? groups.filter(row => row.samples[0].basis === 'disk') : []
  const group = groups.find(row => row.key === seriesKey) ?? (disks.length ? disks : groups).reduce((a,b) =>
    b.samples[b.samples.length - 1].at > a.samples[a.samples.length - 1].at ? b : a)
  const samples = group.samples, first = samples[0], last = samples[samples.length - 1]
  const selected = cursorAt == null ? samples.length - 1 : closestSample(samples, cursorAt)
  const sample = samples[selected], peak = samples.reduce((max, row) => Math.max(max,row.bytesPerSecond), 0)
  const unit = peak >= 1e6 ? 'MB/s' : peak >= 1e3 ? 'KB/s' : 'B/s'
  const divisor = unit === 'MB/s' ? 1e6 : unit === 'KB/s' ? 1e3 : 1
  const speed = formatNumber(sample.bytesPerSecond / divisor, {maximumSignificantDigits:3})
  const clock = (at:number) => formatDate(at,{hour:'2-digit', minute:'2-digit', second:'2-digit'})
  const title = sample.basis === 'session' || sample.basis === 'task' ? t('Processing rate') : t('Transfer speed')
  function seriesLabel(row:Series) {
    const last = row.samples[row.samples.length - 1]
    const metric = last.basis === 'disk' ? last.disk || t('Disk transfer') : last.basis === 'transferred' ? t('Transfer speed') : t('Processing rate')
    return last.taskName || last.taskId ? [last.taskName || last.taskId, metric].join(' · ') : metric
  }

  const duration = last.at - first.at
  const x = (at:number) => duration ? inset + (at - first.at) / duration * (width - inset * 2) : width / 2
  const bottom = height - inset
  const y = (speed:number) => bottom - (peak ? speed / peak : 0) * (height - 2 * inset)
  // A gap in observations stays visible. A single measurement is a dot.
  const paths: {from:number; to:number; line:string; count:number; y:number}[] = []
  samples.forEach((row,index) => {
    const px = Number(x(row.at).toFixed(2)), py = Number(y(row.bytesPerSecond).toFixed(2))
    if (!index || row.at - samples[index - 1].at > 120_000) paths.push({from:px, to:px, y:py, line:'M'+px+' '+py, count:1})
    else {
      const segment = paths[paths.length - 1]
      segment.line += ' L'+px+' '+py
      segment.to = px
      segment.count++
    }
  })
  function point(event: PointerEvent<SVGSVGElement>) {
    if (samples.length < 2) return
    const box = event.currentTarget.getBoundingClientRect()
    const position = ((event.clientX - box.left) / Math.max(1,box.width) * width - inset) / (width - 2 * inset)
    setCursorAt(samples[closestSample(samples, first.at + position * duration)].at)
  }
  function keydown(event: KeyboardEvent<SVGSVGElement>) {
    let next = selected
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(0, selected - 1)
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(samples.length - 1, selected + 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = samples.length - 1
    else return
    event.preventDefault(); setCursorAt(samples[next].at)
  }
  const interactive = samples.length > 1
  const description = [title, speed + ' ' + unit, clock(sample.at)].join(' · ')
  return <figure className={styles.chart} aria-label={t('Speed history')}>
    <figcaption className={styles.heading}>
      <div><span className={styles.title}>{title}</span>
        {groups.length > 1 ? <select className={styles.select} aria-label={t('Speed metric')} value={group.key}
          onChange={event => {setSeriesKey(event.target.value); setCursorAt(undefined)}}>
          {groups.map(row => <option key={row.key} value={row.key}>{seriesLabel(row)}</option>)}</select> :
          (last.disk || last.taskName) && <span className={styles.source} title={last.disk || last.taskName}>{last.disk || last.taskName}</span>}
      </div>
      <div className={styles.reading} title={description}><strong>{speed}</strong><span>{unit}</span></div>
    </figcaption>
    <svg className={styles.plot} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
      role={interactive ? 'slider' : 'img'} tabIndex={interactive ? 0 : undefined} aria-label={interactive ? t('Speed history') : description}
      aria-valuemin={interactive ? 1 : undefined} aria-valuemax={interactive ? samples.length : undefined}
      aria-valuenow={interactive ? selected + 1 : undefined} aria-valuetext={interactive ? description : undefined}
      onPointerMove={point} onPointerDown={point} onPointerLeave={() => setCursorAt(undefined)} onKeyDown={keydown} onBlur={() => setCursorAt(undefined)}>
      <defs><linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".24"/><stop offset="1" stopColor="currentColor" stopOpacity=".025"/></linearGradient></defs>
      <path className={styles.grid} d={`M${inset} ${inset} H${width-inset} M${inset} ${bottom} H${width-inset}`}/>
      {paths.map(segment => segment.count === 1 ? <circle key={segment.from} cx={segment.from} cy={segment.y} r="2" fill="currentColor"/> :
        <g key={segment.from}><path d={segment.line+' L'+segment.to+' '+bottom+' L'+segment.from+' '+bottom+' Z'} fill={'url(#'+fillId+')'}/>
          <path d={segment.line} className={styles.trace}/></g>)}
      {cursorAt != null && <path className={styles.cursor} d={`M${x(sample.at)} ${inset} V${bottom}`}/>}
      <circle className={styles.dot} cx={x(sample.at)} cy={y(sample.bytesPerSecond)} r="3.1"/>
    </svg>
    <div className={styles.axis}><span>{interactive ? clock(first.at) : t('One recorded sample')}</span><time dateTime={new Date(sample.at).toISOString()}>{clock(sample.at)}</time></div>
  </figure>
}
