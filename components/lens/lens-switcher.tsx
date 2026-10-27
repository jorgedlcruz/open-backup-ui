'use client'
import {useMemo,useRef,useState} from 'react'
import Link from 'next/link'
import {Activity,Aperture,ArrowUpRight,Check,ChevronDown,HardDrive,Layers3,Loader2,Star,TrendingUp} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover'
import {lenses,type LensId} from '@/lib/lens/navigation'
import {lensPreviews} from '@/lib/lens/previews'
import type {OperationsSnapshot} from '@/lib/operations/model'
import {useLensPreference} from './lens-preferences'
import styles from './lens-switcher.module.css'

const icons={overview:Layers3,operations:Activity,capacity:HardDrive,forecast:TrendingUp}
const color={Success:'var(--ops-chart-success)',Warning:'var(--ops-chart-warning)',Failed:'var(--ops-chart-danger)'}
type Previews=NonNullable<ReturnType<typeof lensPreviews>>
function Empty({children}:{children:React.ReactNode}){return <div className={styles.noData}>{children}</div>}
function OverviewPreview({data}:{data:Previews['overview']}){
  const summary=data.summary,max=Math.max(1,...data.activity.map(b=>b.Success+b.Warning+b.Failed))
  if(!summary)return <Empty>Session history unavailable</Empty>
  if(!summary.completed)return <Empty>No completed protection runs</Empty>
  return <><div className={styles.figure}><strong>{summary.percent?.toFixed(0)}%</strong><small>session success</small></div><svg className={styles.activity} viewBox="0 0 180 60" preserveAspectRatio="none" role="img" aria-label={`${summary.success} successful, ${summary.warning} warning and ${summary.failed} failed completed sessions`}><line x1="0" x2="180" y1="59" y2="59" stroke="var(--border)"/>{data.activity.map((bucket,index)=>{let y=58;return <g key={index}>{(['Success','Warning','Failed'] as const).map(status=>{const height=bucket[status]/max*52;y-=height;return <rect key={status} x={index*180/data.activity.length+2} y={y} width={180/data.activity.length-5} height={height} rx={1} fill={color[status]}><title>{status}: {bucket[status]}</title></rect>})}</g>})}</svg></>
}
function JobsPreview({data}:{data:Previews['operations']}){
  if(data.attention===null)return <Empty>Job states unavailable</Empty>
  const max=Math.max(1,data.failed||0,data.warning||0,data.active||0)
  return <><div className={styles.figure}><strong>{data.attention}</strong><small>need attention</small></div><div className={styles.rows}>{[{label:'Failed',value:data.failed,tone:'var(--ops-chart-danger)'},{label:'Warning',value:data.warning,tone:'var(--ops-chart-warning)'},{label:'Active',value:data.active,tone:'var(--ops-chart-active)'}].map(row=><div key={row.label}><div className={styles.rowLabel}><span>{row.label}</span><span>{row.value}</span></div><div className={styles.track}><i style={{width:`${(row.value||0)/max*100}%`,background:row.tone}}/></div></div>)}</div></>
}
function CapacityPreview({data}:{data:Previews['capacity']}){
  if(data.atRisk===null)return <Empty>Repository states unavailable</Empty>
  if(!data.total)return <Empty>No repositories returned</Empty>
  return <><div className={styles.figure}><strong>{data.atRisk}</strong><small>at risk</small></div><div className={styles.rows}>{data.rows.map(row=><div key={row.id} title={`${row.name} · ${row.risk}${row.used===null?' · capacity not reported':''}`}><div className={styles.rowLabel}><span>{row.name}</span><span>{row.used===null?'—':`${row.used.toFixed(0)}%`}</span></div><div className={styles.track}><i style={{width:`${row.used??0}%`,background:['Offline','Critical'].includes(row.risk)?'var(--ops-chart-danger)':row.risk==='Healthy'?'var(--ops-chart-success)':'var(--ops-chart-warning)'}}/></div></div>)}</div></>
}
export function LensSwitcher({view,snapshot,loading,stale}:{view:LensId;snapshot:OperationsSnapshot|null;loading:boolean;stale:boolean}){
  const [open,setOpen]=useState(false)
  const selectedLink=useRef<HTMLAnchorElement>(null)
  const activeLens=lenses.find(lens=>lens.id===view)!
  const preview=useMemo(()=>lensPreviews(snapshot),[snapshot]),preference=useLensPreference(),window=snapshot?.range==='7d'?'7 days':snapshot?.range==='30d'?'30 days':'24 hours'
  const context=(id:LensId)=>{
    if(id==='forecast')return 'Retention scenarios and recorded capacity history'
    if(!preview)return 'Preview uses the selected VBR source'
    const partial=preview[id].partial?' · partial snapshot':''
    if(id==='overview')return preview.overview.summary?`${preview.overview.summary.completed} completed runs · ${window}${partial}`:'Session history is not available'
    if(id==='operations')return preview.operations.active===null?'Current job state is not available':`${preview.operations.active} active · current job state${partial}`
    return preview.capacity.total===null?'Repository state is not available':`${preview.capacity.rows.length} of ${preview.capacity.total} repositories · most urgent first${partial}`
  }
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm" className={styles.trigger} aria-label={`Choose your Lens. Current view: ${activeLens.title}`}>
        <Aperture size={15}/><span className={styles.triggerLabel}>Lens:</span>{activeLens.title}<ChevronDown size={14} className={styles.chevron}/>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" sideOffset={10} collisionPadding={12} className={styles.content} aria-label="Protection Lens views" onOpenAutoFocus={event=>{event.preventDefault();selectedLink.current?.focus()}}>
      <div className={styles.heading}>
        <h2><Aperture size={15}/>Choose your Lens</h2>
        <p>{snapshot&&!stale&&!loading&&<span/>}{stale?snapshot?'Previous snapshot · refresh failed':'Previews unavailable':loading?snapshot?'Refreshing previews…':'Loading previews…':snapshot?'Live snapshots · refresh every minute':'Choose a view or set your default'}</p>
      </div>
      <nav className={styles.deck} aria-label="Choose a Protection Lens">
        {lenses.map(lens=>{
          const Icon=icons[lens.id],selected=view===lens.id,isDefault=preference.defaultView===lens.id
          return <article key={lens.id} className={`${styles.card} ${selected?styles.selected:''}`}>
            <Link ref={selected?selectedLink:undefined} href={lens.href} className={styles.open} aria-current={selected?'page':undefined} aria-label={`Open ${lens.title} Lens`} onClick={()=>setOpen(false)}>
              <div className={styles.titleRow}><span className={styles.icon}><Icon size={17}/></span><div><h3>{lens.title}</h3><p>{lens.category}</p></div><ArrowUpRight size={15} className={styles.arrow}/></div>
              <p className={styles.description}>{lens.description}</p>
              <div className={styles.preview}>{lens.id==='forecast'?<Empty><TrendingUp size={22}/>Explore 30 / 60 / 90 day scenarios</Empty>:!preview?<Empty>{loading?<><Loader2 size={13} className="animate-spin"/>Loading live preview</>:'Open a health Lens for a live preview'}</Empty>:lens.id==='overview'?<OverviewPreview data={preview.overview}/>:lens.id==='operations'?<JobsPreview data={preview.operations}/>:<CapacityPreview data={preview.capacity}/>}</div>
              <small className={styles.context}>{context(lens.id)}</small>
            </Link>
            <div className={styles.foot}>
              {selected&&<span className={styles.current}><Check size={12}/>Viewing</span>}
              <button className={styles.defaultButton} aria-label={isDefault?`${lens.title} is the default view`:`Make ${lens.title} the default view`} aria-pressed={isDefault} title="Choose the VBR view that opens after sign-in in this browser" disabled={!!preference.saving||isDefault} onClick={()=>void preference.save(lens.id)}>
                {preference.saving===lens.id?<Loader2 size={13} className="animate-spin"/>:<Star size={13}/>} {preference.saving===lens.id?'Saving…':isDefault?'Default view':'Make default'}
              </button>
            </div>
          </article>
        })}
      </nav>
      <p className={styles.footnote}><Star size={11}/>Your default opens when you enter Protection Lens or sign in to VBR. Saved for this browser.</p>
      {preference.error?<p role="alert" className={`${styles.message} ${styles.error}`}>{preference.error}</p>:<p role="status" className={preference.message?styles.message:undefined}>{preference.message}</p>}
    </PopoverContent>
  </Popover>
}
