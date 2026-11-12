'use client'
// Open Backup UI v1.2.0
import {useEffect,useMemo,useRef,useState} from 'react'
import Link from 'next/link'
import {Activity,Aperture,ArrowUpRight,Check,ChevronDown,HardDrive,Layers3,Loader2,Star,TrendingUp} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover'
import {lenses,type LensId} from '@/lib/lens/navigation'
import {lensPreviews} from '@/lib/lens/previews'
import type {ForecastPreview} from '@/lib/lens/forecast-preview'
import {ForecastMiniature} from './forecast-miniature'
import type {OperationsSnapshot} from '@/lib/operations/model'
import {useLensPreference} from './lens-preferences'
import styles from './lens-switcher.module.css'
import {useI18n} from '@/components/providers/i18n-provider'

const icons={overview:Layers3,operations:Activity,capacity:HardDrive,forecast:TrendingUp}
const color={Success:'var(--ops-chart-success)',Warning:'var(--ops-chart-warning)',Failed:'var(--ops-chart-danger)'}
type Previews=NonNullable<ReturnType<typeof lensPreviews>>
function Empty({children}:{children:React.ReactNode}){return <div className={styles.noData}>{children}</div>}
function OverviewPreview({data}:{data:Previews['overview']}){
  const {t,formatNumber}=useI18n()
  const summary=data.summary,max=Math.max(1,...data.activity.map(b=>b.Success+b.Warning+b.Failed))
  if(!summary)return <Empty>{t("Session history unavailable")}</Empty>
  if(!summary.completed)return <Empty>{t("No completed protection runs")}</Empty>
  return <><div className={styles.figure}><strong>{formatNumber((summary.percent??0)/100,{style:'percent',maximumFractionDigits:0})}</strong><small>{t("session success")}</small></div><svg className={styles.activity} viewBox="0 0 180 60" preserveAspectRatio="none" role="img" aria-label={t('{success} successful, {warning} warning and {failed} failed completed sessions',{success:formatNumber(summary.success),warning:formatNumber(summary.warning),failed:formatNumber(summary.failed)})}><line x1="0" x2="180" y1="59" y2="59" stroke="var(--border)"/>{data.activity.map((bucket,index)=>{let y=58;return <g key={index}>{(['Success','Warning','Failed'] as const).map(status=>{const height=bucket[status]/max*52;y-=height;return <rect key={status} x={index*180/data.activity.length+2} y={y} width={180/data.activity.length-5} height={height} rx={1} fill={color[status]}><title>{t(status)}: {formatNumber(bucket[status])}</title></rect>})}</g>})}</svg></>
}
function JobsPreview({data}:{data:Previews['operations']}){
  const {t,formatNumber}=useI18n()
  if(data.attention===null)return <Empty>{t("Job states unavailable")}</Empty>
  const max=Math.max(1,data.failed||0,data.warning||0,data.active||0)
  return <><div className={styles.figure}><strong>{formatNumber(data.attention)}</strong><small>{t("need attention")}</small></div><div className={styles.rows}>{[{label:'Failed',value:data.failed,tone:'var(--ops-chart-danger)'},{label:'Warning',value:data.warning,tone:'var(--ops-chart-warning)'},{label:'Active',value:data.active,tone:'var(--ops-chart-active)'}].map(row=><div key={t(row.label)}><div className={styles.rowLabel}><span>{t(row.label)}</span><span>{row.value===null?'—':formatNumber(row.value)}</span></div><div className={styles.track}><i style={{width:`${(row.value||0)/max*100}%`,background:row.tone}}/></div></div>)}</div></>
}
function CapacityPreview({data}:{data:Previews['capacity']}){
  const {t,formatNumber}=useI18n()
  if(data.atRisk===null)return <Empty>{t("Repository states unavailable")}</Empty>
  if(!data.total)return <Empty>{t("No repositories returned")}</Empty>
  return <><div className={styles.figure}><strong>{formatNumber(data.atRisk)}</strong><small>{t("at risk")}</small></div><div className={styles.rows}>{data.rows.map(row=><div key={row.id} title={`${row.name} · ${t(row.risk)}${row.used===null?` · ${t('Capacity not reported')}`:''}`}><div className={styles.rowLabel}><span>{row.name}</span><span>{row.used===null?'—':formatNumber(row.used/100,{style:'percent',maximumFractionDigits:0})}</span></div><div className={styles.track}><i style={{width:`${row.used??0}%`,background:['Offline','Critical'].includes(row.risk)?'var(--ops-chart-danger)':row.risk==='Healthy'?'var(--ops-chart-success)':'var(--ops-chart-warning)'}}/></div></div>)}</div></>
}
export function LensSwitcher({view,snapshot,loading,stale}:{view:LensId;snapshot:OperationsSnapshot|null;loading:boolean;stale:boolean}){
  const {t,formatNumber,formatDate}=useI18n()
  const [open,setOpen]=useState(false)
  const [forecast,setForecast]=useState<ForecastPreview|null>(null),[forecastLoading,setForecastLoading]=useState(false),[forecastError,setForecastError]=useState(false)
  useEffect(()=>{
    if(!open)return
    const controller=new AbortController();let pending=false
    setForecast(null);setForecastLoading(true);setForecastError(false)
    const read=async()=>{
      if(pending||document.hidden)return
      pending=true
      try {
        const response=await fetch('/api/vbr/forecast?preview=1',{cache:'no-store',signal:controller.signal})
        if(!response.ok)throw new Error('Preview unavailable')
        const result=await response.json() as {preview:ForecastPreview|null}
        if(!controller.signal.aborted){setForecast(result.preview);setForecastError(false)}
      }catch{if(!controller.signal.aborted){setForecast(null);setForecastError(true)}}
      finally{pending=false;if(!controller.signal.aborted)setForecastLoading(false)}
    }
    void read()
    const timer=setInterval(()=>void read(),15000)
    return()=>{controller.abort();clearInterval(timer)}
  },[open,snapshot?.sourceName])
  const selectedLink=useRef<HTMLAnchorElement>(null)
  const activeLens=lenses.find(lens=>lens.id===view)!
  const preview=useMemo(()=>lensPreviews(snapshot),[snapshot]),preference=useLensPreference(),window=t(snapshot?.range==='7d'?'7 days':snapshot?.range==='30d'?'30 days':'24 hours')
  const context=(id:LensId)=>{
    if(id==='forecast')return forecast?<><span className={styles.repositoryName} title={forecast.name}>{forecast.name}</span>{forecast.mode==='files'?t('Modeled backups only'):t('Recorded volume usage')} · {forecast.stale?t('Previous cache'):t('Cached')} {formatDate(forecast.fetchedAt,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}{forecast.partial?' · '+t('Partial snapshot'):''}{forecast.refreshing?' · '+t('Refreshing…'):''}</>:t('Open Forecast to collect evidence when no cache is available')
    if(!preview)return t('Preview uses the selected VBR source')
    const partial=preview[id].partial?' · '+t('Partial snapshot'):''
    if(id==='overview')return preview.overview.summary?t('{count} completed runs · {window}',{count:formatNumber(preview.overview.summary.completed),window})+partial:t('Session history is not available')
    if(id==='operations')return preview.operations.active===null?t('Current job state is not available'):t('{count} active · current job state',{count:formatNumber(preview.operations.active)})+partial
    return preview.capacity.total===null?t('Repository state is not available'):t('{count} of {total} repositories · most urgent first',{count:formatNumber(preview.capacity.rows.length),total:formatNumber(preview.capacity.total)})+partial
  }
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm" className={styles.trigger} aria-label={t('Choose your Lens. Current view: {view}',{view:t(activeLens.title)})}>
        <Aperture size={15}/><span className={styles.triggerLabel}>Lens:</span>{t(activeLens.title)}<ChevronDown size={14} className={styles.chevron}/>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" sideOffset={10} collisionPadding={12} className={styles.content} aria-label={t("Protection Lens views")} onOpenAutoFocus={event=>{event.preventDefault();selectedLink.current?.focus()}}>
      <div className={styles.heading}>
        <h2><Aperture size={15}/>{t("Choose your Lens")}</h2>
        <p>{snapshot&&!stale&&!loading&&<span/>}{stale?snapshot?t("Previous snapshot · refresh failed"):t("Previews unavailable"):loading?snapshot?t("Refreshing previews…"):t("Loading previews…"):snapshot?t("Live snapshots · refresh every minute"):t("Choose a view or set your default")}</p>
      </div>
      <nav className={styles.deck} aria-label={t("Choose a Protection Lens")}>
        {lenses.map(lens=>{
          const Icon=icons[lens.id],selected=view===lens.id,isDefault=preference.defaultView===lens.id
          return <article key={lens.id} className={`${styles.card} ${selected?styles.selected:''}`}>
            <Link ref={selected?selectedLink:undefined} href={lens.id==='forecast'&&forecast?`${lens.href}?repository=${encodeURIComponent(forecast.repositoryId)}&mode=${forecast.mode}`:lens.href} className={styles.open} aria-current={selected?'page':undefined} aria-label={t('Open {view} Lens',{view:t(lens.title)})} onClick={()=>setOpen(false)}>
              <div className={styles.titleRow}><span className={styles.icon}><Icon size={17}/></span><div><h3>{t(lens.title)}</h3><p>{t(lens.category)}</p></div><ArrowUpRight size={15} className={styles.arrow}/></div>
              <p className={styles.description}>{t(lens.description)}</p>
              <div className={styles.preview}>{lens.id==='forecast'?forecast?<ForecastMiniature data={forecast}/>:<Empty>{forecastLoading?<><Loader2 size={13} className="animate-spin"/>{t('Reading cached forecast…')}</>:forecastError?t('Cached preview unavailable'):t('No cached forecast yet')}</Empty>:!preview?<Empty>{loading?<><Loader2 size={13} className="animate-spin"/>{t("Loading live preview")}</>:t("Open a health Lens for a live preview")}</Empty>:lens.id==='overview'?<OverviewPreview data={preview.overview}/>:lens.id==='operations'?<JobsPreview data={preview.operations}/>:<CapacityPreview data={preview.capacity}/>}</div>
              <small className={styles.context}>{context(lens.id)}</small>
            </Link>
            <div className={styles.foot}>
              {selected&&<span className={styles.current}><Check size={12}/>{t("Viewing")}</span>}
              <button className={styles.defaultButton} aria-label={t(isDefault?'{view} is the default view':'Make {view} the default view',{view:t(lens.title)})} aria-pressed={isDefault} title={t("Choose the VBR view that opens after sign-in in this browser")} disabled={!!preference.saving||isDefault} onClick={()=>void preference.save(lens.id)}>
                {preference.saving===lens.id?<Loader2 size={13} className="animate-spin"/>:<Star size={13}/>} {preference.saving===lens.id?t("Saving…"):isDefault?t("Default view"):t("Make default")}
              </button>
            </div>
          </article>
        })}
      </nav>
      <p className={styles.footnote}><Star size={11}/>{t("Your default opens when you enter Protection Lens or sign in to VBR. Saved for this browser.")}</p>
      {preference.error?<p role="alert" className={`${styles.message} ${styles.error}`}>{preference.error}</p>:<p role="status" className={preference.message?styles.message:undefined}>{preference.message}</p>}
    </PopoverContent>
  </Popover>
}
