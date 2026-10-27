"use client"

import { useEffect, useRef, useState } from 'react'
import { Empty, Pager } from '@/components/investigation/shared'
import { rpoStatus, type Row } from '@/lib/protected-data/model'
import { protectionColors as mapColors, protectionTextColors, protectionStatusLabel } from '@/lib/protected-data/colors'
import { workloadLabel } from '@/lib/protected-data/rpo'
import styles from './protected-data-operations.module.css'


export function HexMap({rows,hours,now,mode,onSelect}:{rows:Row[];hours:number;now:number;mode:'rpo'|'coverage';onSelect:(row:Row)=>void}) {
  const [page,setPage]=useState(0)
  const container=useRef<HTMLDivElement>(null),[mapWidth,setMapWidth]=useState(800)
  useEffect(()=>{
    const element=container.current
    if(!element)return
    const observer=new ResizeObserver(([entry])=>setMapWidth(entry.contentRect.width))
    observer.observe(element)
    return ()=>observer.disconnect()
  },[])
  const current=Math.min(page,Math.max(0,Math.ceil(rows.length/240)-1)),shown=rows.slice(current*240,(current+1)*240)
  const status=(row:Row)=>mode==='rpo' ? rpoStatus(row,hours,now):row.run==='Failed' ? 'Failed':row.coverage
  const labels=mode==='rpo' ? ['Within threshold','Outside threshold','No restore points','Unknown']:['Restore points available','Failed','No restore points','Count not reported']
  const columns=Math.max(1,Math.min(10,shown.length,Math.floor((mapWidth-54)/108))),height=Math.ceil(shown.length/columns)*93+30,width=columns*108+54
  // A hexagon represents one object in one backup, so distinct copies remain selectable.
  return <>
    <div className={styles.legend}>{labels.map(label=><span key={label} style={{display:'inline-flex',gap:7,alignItems:'center'}}><i style={{background:mapColors[label]}}/>{protectionStatusLabel(label)} <strong>{rows.filter(r=>status(r)===label).length}</strong></span>)}</div>
    <div ref={container} className={`${styles.map} ${styles.namedMap}`}>{shown.length ? <svg viewBox={`-54 -62 ${width} ${height}`} style={{width,minWidth:width,height}} aria-label="Protected backup records HexMap" role="group">
      {shown.map((row,index)=>{
        const line=Math.floor(index/columns),x=index%columns*108+(line%2 ? 54:0),y=line*93,value=status(row),name=workloadLabel(row.name),statusLabel=protectionStatusLabel(value)
        return <g key={row.key} transform={`translate(${x},${y})`} role="button" tabIndex={0} className={styles.hex}
          aria-label={`${row.name}, ${row.backup?.name || row.object.backupId || 'Backup not reported'}, ${statusLabel}`}
          onClick={()=>onSelect(row)} onKeyDown={e=>{if(e.key==='Enter' || e.key===' '){e.preventDefault();onSelect(row)}}} style={{fill:mapColors[value]}}>
          <title>{row.name} · {row.backup?.name || row.object.backupId || 'Backup not reported'} · {statusLabel} · {row.points ?? 'Unknown'} restore points</title>
          <polygon points="0,-60 52,-30 52,30 0,60 -52,30 -52,-30"/>
          <text style={{fill:protectionTextColors[value]}} className={styles.hexLabel} textAnchor="middle" dominantBaseline="middle" aria-hidden="true">{name.map((line,index)=><tspan key={index} x={0} y={(index-(name.length-1)/2)*14}>{line}</tspan>)}</text>
        </g>
      })}
    </svg>:<Empty>No backup records match these filters.</Empty>}</div>
    <Pager page={current} count={rows.length} size={240} onChange={setPage} label="HexMap records"/>
  </>
}
