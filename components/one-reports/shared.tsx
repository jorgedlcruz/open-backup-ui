'use client'
import {useEffect,useState,type ReactNode} from 'react'
import Link from 'next/link'
import { ArrowUpRight, RefreshCw } from 'lucide-react'
import {Button} from '@/components/ui/button'
import ops from '@/components/operations/operations.module.css'
import styles from './reports.module.css'

export async function read<T>(query:Record<string,string>,signal?:AbortSignal):Promise<T>{const response=await fetch(`/api/one/reports?${new URLSearchParams(query)}`,{signal,cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'The report request failed.');return data}
export async function post<T>(body:unknown,signal?:AbortSignal):Promise<T>{const response=await fetch('/api/one/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});const data=await response.json();if(!response.ok)throw new Error(data.error||'The report request failed.');return data}
export function useRead<T>(query:Record<string,string>|null){
  const [data,setData]=useState<T|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0),key=query?JSON.stringify(query):''
  useEffect(()=>{setData(null);setError('');if(!key)return;const controller=new AbortController();setLoading(true);read<T>(JSON.parse(key),controller.signal).then(setData).catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});return()=>controller.abort()},[key,revision])
  return {data,error,loading:loading||!!key&&!data&&!error,refresh:()=>setRevision(n=>n+1)}
}
export function Header({title,description,source,children}:{title:string;description:string;source?:string;children?:ReactNode}){return <header className={ops.header}><div><h1>{title}</h1><p>{description}</p></div><div className={styles.actions}>{source&&<span className={ops.source}><i className={`${ops.dot} ${ops.connected}`}/>{source}</span>}{children}</div></header>}
export function Panel({title,description,action,children}:{title:string;description?:string;action?:ReactNode;children:ReactNode}){return <section className={ops.panel} aria-label={title}><div className={ops.panelHeading}><div><h2>{title}</h2>{description&&<p>{description}</p>}</div>{action}</div>{children}</section>}
export function Status({value}:{value:string}){const tone=/^(Completed|Ready|Embedded)$/.test(value)?'success':/Failed|Error|Denied/.test(value)?'danger':/Running|Loading/.test(value)?'active':/Canceled|Expired|Restricted/.test(value)?'warning':'neutral';return <span className={`${ops.badge} ${ops[tone]}`}>{value}</span>}
export function Notice({error,retry}:{error:string;retry?:()=>void}){return <div className={ops.notice} role="alert"><div><strong>{error}</strong><p>Check the selected data source or reconnect if its session has expired.</p></div>{retry&&<Button variant="outline" size="sm" onClick={retry}><RefreshCw size={14}/>Retry</Button>}<Link href="/connect">Connect <ArrowUpRight size={14}/></Link></div>}
export function Metrics({items}:{items:{label:string;value:ReactNode;note:string}[]}){return <div className={ops.metrics}>{items.map(item=><div key={item.label} className={ops.metric}><div className={ops.metricLabel}>{item.label}</div><div className={ops.metricValue}>{item.value}</div><p>{item.note}</p></div>)}</div>}
export function Download({data,name}:{data:unknown;name:string}){return <Button variant="outline" size="sm" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`${name.replace(/[^\w-]/g,'_')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}}>Export JSON</Button>}
