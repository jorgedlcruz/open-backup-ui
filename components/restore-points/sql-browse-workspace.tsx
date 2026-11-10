'use client'
// Open Backup UI v1.2.0
import {useId,useState, type ReactNode} from 'react'
import {ArrowLeft, ChevronDown, ChevronRight, Database, File, Folder, Layers3, Search, Server} from 'lucide-react'
import {Button} from '@/components/ui/button'
import type {AdScope} from '@/lib/restore-points/ad-client'
import type {SqlRecoveryPreset} from '@/lib/restore-points/sql-action-presets'
import type {SqlIntent, SqlItem} from './sql-explorer'
import {SqlRecoveryActions} from './sql-recovery-actions'
import {SqlRecoveryContext} from './sql-recovery-context'
import {useRecoveryPresentation} from './use-presentation'
import {useSqlCatalog, sqlNodeId} from './use-sql-catalog'
import {RecoverySignal} from './recovery-signal'
import css from './sql-browse-workspace.module.css'

type Focus = {level:'auto'|'server'|'instance'|'database'; server?:string; instance?:string; database?:string}
type Props = {scope:AdScope; revision:number; selectionReset:number; disabled:boolean; commands:ReactNode;
  onPrepare:(intent:SqlIntent, preset:SqlRecoveryPreset, databases:SqlItem[])=>void}
const listSize = 30
const maxSelected = 128
function displayName(row:SqlItem) { return row.name || row.serverName || row.vmName || '—' }
function shortVersion(value:string) {
  const name = value.match(/(?:Microsoft\s+)?SQL Server\s+\d{4}/i)?.[0]?.replace(/^Microsoft\s+/i,'')
  const build = value.match(/\b\d{1,2}\.\d+\.\d+(?:\.\d+)?\b/)?.[0]
  return [name, build].filter(Boolean).join(' · ') || value.split(/\r?\n/)[0].slice(0,90)
}
function recoveryTime(row:SqlItem) {return row.timeRange?.to || row.timeRange?.endTime || row.guestBackupEndTime || row.backupCreated}

function TreeRow({row,expanded,current,open,disclose}:{
  row:SqlItem; expanded?:boolean;current?:boolean;open:()=>void;disclose?:()=>void
}) {
  const {t}=useRecoveryPresentation()
  const Icon=row.type==='SQLServer'?Server:row.type==='SQLInstance'?Layers3:Database
  const name=displayName(row)
  return <div className={css.treeRow} data-current={current||undefined}>
    {disclose?<button type="button" className={css.disclose} aria-expanded={expanded} aria-label={t(expanded?'Collapse {name}':'Expand {name}',{name})} onClick={disclose}>
      {expanded?<ChevronDown size={13}/>:<ChevronRight size={13}/>}</button>:<span className={css.spacer}/>}
    <button type="button" className={css.node} onClick={open} aria-current={current?'location':undefined} title={name}>
      <Icon size={15}/><span>{name}</span></button>
  </div>
}

function ReadState({rows,label,emptyText}:{rows:ReturnType<typeof useSqlCatalog>;label:string;emptyText:string}) {
  const {t,diagnostic}=useRecoveryPresentation()
  if(rows.error)return <div className={css.readError} role="alert"><span>{diagnostic(rows.error)}</span>
    <Button type="button" size="sm" variant="outline" onClick={rows.retry}>{t('Retry')}</Button></div>
  if(!rows.complete)return <RecoverySignal compact stage="data" status={label}/>
  if(!rows.items.length)return <p className={css.empty}>{emptyText}</p>
  return null
}

function Fact({label,children}:{label:string;children:ReactNode}) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>
}

export function SqlBrowseWorkspace({scope,revision,selectionReset,disabled,commands,onPrepare}:Props) {
  const {t,date,formatNumber}=useRecoveryPresentation()
  const selectionId=useId()
  const [focus,setFocus]=useState<Focus>({level:'auto'})
  const [collapsed,setCollapsed]=useState<string[]>([])
  const [chosen,setChosen]=useState<{scope:string;reset:number;ids:string[]}>({scope:'',reset:0,ids:[]})
  const [search,setSearch]=useState(''),[page,setPage]=useState(0),[treeCount,setTreeCount]=useState(listSize)
  const servers=useSqlCatalog(scope,'servers',undefined,revision)
  const server=servers.items.find(row=>sqlNodeId(row)===focus.server) || (servers.complete&&servers.items.length===1?servers.items[0]:undefined)
  const instances=useSqlCatalog(scope,'instances',server,revision)
  const instance=instances.items.find(row=>sqlNodeId(row)===focus.instance) || (focus.level==='auto'&&instances.complete&&instances.items.length===1?instances.items[0]:undefined)
  const dbs=useSqlCatalog(scope,'databases',instance,revision)
  const serverFocus=!!server&&!instance&&instances.complete&&instances.items.length>0
  const descendants=useSqlCatalog(scope,'databases',instances.items,revision,serverFocus)
  const focusedDb=focus.level==='database'?dbs.items.find(row=>sqlNodeId(row)===focus.database):undefined
  const files=useSqlCatalog(scope,'files',focusedDb,revision)
  const serverId=server&&sqlNodeId(server),instanceId=instance&&sqlNodeId(instance),dbId=focusedDb&&sqlNodeId(focusedDb)
  const branch=JSON.stringify([serverId,instanceId]),marked=chosen.scope===branch&&chosen.reset===selectionReset?chosen.ids:[]
  const selected=dbs.items.filter(db=>marked.includes(sqlNodeId(db)))
  const target=focusedDb?[focusedDb]:selected.length?selected:serverFocus?descendants.items:dbs.items
  const scopeKind=focusedDb||selected.length?'databases':serverFocus?'server':'instance'
  // A group must never silently shrink when VBR is still paging or a selected object disappeared.
  const completeSelection=!!focusedDb || (serverFocus?descendants.complete:marked.length>0 ? marked.length===selected.length : dbs.complete)
  const base=instance?dbs:server?instances:servers
  const view=focusedDb?'database':instance?'instance':server?'server':'servers'
  const matching=base.items.filter(row=>displayName(row).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const currentPage=Math.min(page,Math.max(0,Math.ceil(matching.length/listSize)-1)),shown=matching.slice(currentPage*listSize,(currentPage+1)*listSize)
  const title=focusedDb?displayName(focusedDb):instance?displayName(instance):server?displayName(server):t('Servers')
  const path=[server,instance,focusedDb].filter((row):row is SqlItem=>!!row)
  const icon=view==='database'?Database:view==='instance'?Layers3:Server,Icon=icon
  function navigate(next:Focus){
    setFocus(next);setSearch('');setPage(0);setTreeCount(listSize)
    setCollapsed(list=>list.filter(id=>id!==next.server&&id!==next.instance))
  }
  function openServer(row:SqlItem){navigate({level:'server',server:sqlNodeId(row)})}
  function openInstance(row:SqlItem){navigate({level:'instance',server:serverId,instance:sqlNodeId(row)})}
  function openDatabase(row:SqlItem){navigate({level:'database',server:serverId,instance:instanceId,database:sqlNodeId(row)})}
  function fold(id:string,isActive:boolean,open:()=>void){if(!isActive)open();else setCollapsed(old=>old.includes(id)?old.filter(key=>key!==id):[...old,id])}
  function selectRows(ids:string[]) {setChosen({scope:branch,reset:selectionReset,ids})}
  function selectOne(row:SqlItem) {
    const id=sqlNodeId(row)
    selectRows(marked.includes(id)?marked.filter(other=>other!==id):[...marked,id])
  }
  const allShown=shown.length>0&&shown.every(row=>marked.includes(sqlNodeId(row)))
  const addShown=Array.from(new Set([...marked,...shown.map(sqlNodeId)]))
  const showActions=(!!instance||serverFocus)&&target.length>0
  const loading=t(view==='servers'?'Loading SQL servers…':view==='server'?'Loading SQL instances…':'Loading databases…')
  const emptyText=t(view==='servers'?'VBR returned no SQL servers for this restore point.':view==='server'?'VBR returned no instances for this server.':'VBR returned no databases for this instance.')
  return <><div className={css.commandBar}>
    <div className={css.commandHeading}><h3><Database size={18} aria-hidden/>{t('Microsoft SQL Server')}</h3>
      {showActions&&<div className={css.actionScope} aria-live="polite"><span id={selectionId}>{focusedDb?t('Database actions')+' · '+title:marked.length?t('{count} selected',{count:formatNumber(marked.length)}):(serverFocus?t('Server actions'):t('Instance actions'))+' · '+title}</span>
        {!focusedDb&&marked.length>0&&<button type="button" onClick={()=>selectRows([])}>{t('Clear selection')}</button>}</div>}
    </div>
    <div className={css.commandButtons}>{showActions&&<SqlRecoveryActions databases={target} scopeKind={scopeKind} scopeDescription={selectionId} disabled={disabled||!completeSelection||target.length>maxSelected}
      onAction={(intent,preset)=>{if(completeSelection&&target.length<=maxSelected)onPrepare(intent,preset,target)}}/>}{commands}</div>
  </div>
  {target.length>maxSelected&&<p className={css.empty}>{t('Select up to 128 databases for one operation.')}</p>}
  <div className={css.workspace}>
    <nav className={css.tree} aria-label={t('SQL inventory')}>
      <h4><Layers3 size={15}/>{t('SQL inventory')}</h4>
      <ul>{servers.items.map(s=>{
        const sid=sqlNodeId(s),thisServer=sid===serverId,expanded=thisServer&&!collapsed.includes(sid)
        return <li key={sid}><TreeRow row={s} current={thisServer&&!instance} expanded={expanded} open={()=>openServer(s)} disclose={()=>fold(sid,thisServer,()=>openServer(s))}/>
          {expanded&&<ul>{instances.items.map(i=>{
            const iid=sqlNodeId(i),thisInstance=iid===instanceId,open=thisInstance&&!collapsed.includes(iid)
            return <li key={iid}><TreeRow row={i} current={thisInstance&&!focusedDb} expanded={open} open={()=>openInstance(i)} disclose={()=>fold(iid,thisInstance,()=>openInstance(i))}/>
              {open&&<ul>{dbs.items.slice(0,treeCount).map(db=><li key={sqlNodeId(db)}><TreeRow row={db} current={sqlNodeId(db)===dbId} open={()=>openDatabase(db)}/></li>)}
                {dbs.items.length>treeCount&&<li><button className={css.more} type="button" onClick={()=>setTreeCount(n=>n+listSize)}>{t('Show more databases')}</button></li>}</ul>}
            </li>})}</ul>}</li>
      })}</ul>
    </nav>
    <section className={css.detail} aria-label={t('SQL workspace')}>
      <header className={css.detailHeader}><span className={css.symbol} aria-hidden><Icon size={23}/></span><div>
        <p>{view==='servers'?t('Microsoft SQL Server'):view==='server'?t('Server'):view==='instance'?t('SQL instance'):t('Database')}</p><h3>{title}</h3>
        {path.length>1&&<span className={css.location}>{path.slice(0,-1).map(displayName).join(' / ')}</span>}
      </div></header>
      {instance?.fullVersion&&<details className={css.version}><summary><span>{t('Version')}</span> {shortVersion(instance.fullVersion)}</summary><p>{instance.fullVersion}</p></details>}
      <SqlRecoveryContext items={completeSelection&&target.length?target:path.slice(-1)}/>
      {serverFocus&&!descendants.complete&&<ReadState rows={descendants} label={t('Loading databases…')} emptyText=""/>}
      {focusedDb?<><div className={css.objectTitle}><Button size="sm" variant="ghost" onClick={()=>instance&&openInstance(instance)}><ArrowLeft size={14}/>{t('Databases')}</Button></div>
        <dl className={css.facts}>
          {focusedDb.recoveryModel&&<Fact label={t('Recovery model')}>{focusedDb.recoveryModel}</Fact>}
          {recoveryTime(focusedDb)&&<Fact label={t('Latest recovery time')}>{date(recoveryTime(focusedDb))}</Fact>}
          {typeof focusedDb.isReadOnly==='boolean'&&<Fact label={t('Read-only')}>{focusedDb.isReadOnly?t('Yes'):t('No')}</Fact>}
          {typeof focusedDb.isSystem==='boolean'&&<Fact label={t('System database')}>{focusedDb.isSystem?t('Yes'):t('No')}</Fact>}
        </dl><h4 className={css.listTitle}><Folder size={16}/>{t('Database files')}</h4>
        {files.items.flatMap(row=>[{kind:t('Primary file'),paths:[row.primaryFile]},{kind:t('Secondary file'),paths:row.secondaryFiles||[]},{kind:t('BLOB folder'),paths:row.blobFolders||[]}]
          .flatMap(group=>group.paths.filter((path):path is string=>!!path).map(path=><div className={css.file} key={group.kind+path}><File size={15}/><div><small>{group.kind}</small><span>{path}</span></div></div>)))}
        <ReadState rows={files} label={t('Loading database files…')} emptyText={t('VBR returned no files for this database.')}/>
      </>:<>
        <div className={css.listHead}><h4>{view==='instance'?t('Databases'):view==='server'?t('Instances'):t('Servers')}
          {base.complete&&<span>{formatNumber(base.items.length)}</span>}</h4>
          {base.items.length>listSize&&<label className={css.filter}><Search size={14}/><input type="search" value={search} aria-label={t('Search')} placeholder={t('Search')}
            onChange={e=>{setSearch(e.target.value);setPage(0)}}/></label>}</div>
        {shown.length>0&&<table className={css.table}><thead><tr>{instance&&<th className={css.checkCell}>
          <input type="checkbox" aria-label={t('Select visible databases')} checked={allShown} disabled={disabled||(!allShown&&addShown.length>maxSelected)}
            ref={element=>{if(element)element.indeterminate=!allShown&&shown.some(row=>marked.includes(sqlNodeId(row)))}}
            onChange={()=>selectRows(allShown?marked.filter(id=>!shown.some(row=>sqlNodeId(row)===id)):addShown)}/></th>}
          <th>{t('Name')}</th>{view==='instance'?<th>{t('Recovery model')}</th>:view==='server'?<th>{t('Version')}</th>:null}
        </tr></thead><tbody>{shown.map(row=>{
          const ItemIcon=instance?Database:server?Layers3:Server,id=sqlNodeId(row),isChecked=marked.includes(id)
          return <tr key={id} data-selected={!!instance&&isChecked||undefined}>
            {instance&&<td className={css.checkCell}><input type="checkbox" aria-label={t('Select {name}',{name:displayName(row)})}
              checked={isChecked} disabled={disabled||(!isChecked&&marked.length>=maxSelected)} onChange={()=>selectOne(row)}/></td>}
            <td><button type="button" className={css.rowLink} onClick={()=>instance?openDatabase(row):server?openInstance(row):openServer(row)}><ItemIcon size={15}/>{displayName(row)}</button></td>
            {instance?<td>{row.recoveryModel||'—'}</td>:server?<td title={row.fullVersion}>{row.fullVersion?shortVersion(row.fullVersion):'—'}</td>:null}
          </tr>
        })}</tbody></table>}
        {search&&!matching.length&&base.items.length>0&&<p className={css.empty}>{t('No matches')}</p>}
        <ReadState rows={base} label={loading} emptyText={emptyText}/>
        {matching.length>listSize&&<div className={css.pager}><span>{t('{start}–{end} of {count}',{start:formatNumber(currentPage*listSize+1),end:formatNumber(Math.min((currentPage+1)*listSize,matching.length)),count:formatNumber(matching.length)})}</span>
          <Button size="sm" variant="outline" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>{t('Previous')}</Button>
          <Button size="sm" variant="outline" disabled={(currentPage+1)*listSize>=matching.length} onClick={()=>setPage(currentPage+1)}>{t('Next')}</Button></div>}
      </>}
    </section>
  </div></>
}
