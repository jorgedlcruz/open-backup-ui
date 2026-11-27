'use client'
// Open Backup UI v1.3.0
import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogTrigger } from '@/components/ui/dialog'
import { DataLoading } from '@/components/ui/data-loading'
import { useI18n } from '@/components/providers/i18n-provider'
import { useDisplayFormat } from '@/components/providers/use-display-format'
import { veeamApi } from '@/lib/api/veeam-client'
import { vbrError } from '@/lib/i18n/vbr-errors'
import { itemKey,type GlobalInventoryPlatform,type InventoryLookupPage } from '@/lib/virtual-infrastructure/model'
import ops from '@/components/operations/operations.module.css'

export function PlatformInventorySearch({platforms}:{platforms:GlobalInventoryPlatform[]}) {
  const {t,formatNumber}=useI18n()
  const {label}=useDisplayFormat()
  const [open,setOpen]=useState(false)
  const [platform,setPlatform]=useState(platforms[0]),[name,setName]=useState('')
  const [page,setPage]=useState<InventoryLookupPage>(),[previous,setPrevious]=useState<number[]>([])
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const request=useRef<AbortController | null>(null)
  useEffect(()=>()=>request.current?.abort(),[])
  function clear() {
    request.current?.abort()
    setPage(undefined);setPrevious([]);setError('');setBusy(false)
  }
  async function search(skip:number,history:number[]) {
    request.current?.abort()
    const controller=new AbortController()
    request.current=controller
    setBusy(true);setError('')
    try {
      const next=await veeamApi.searchVirtualInventory(platform,name.trim(),skip,controller.signal)
      if(!controller.signal.aborted){setPage(next);setPrevious(history)}
    } catch(issue) {
      if(!controller.signal.aborted)setError(issue instanceof Error ? vbrError(t,issue.message) : t('Virtual inventory is unavailable. Use Refresh to retry.'))
    } finally {if(!controller.signal.aborted)setBusy(false)}
  }
  return <Dialog open={open} onOpenChange={next=>{if(!next)clear();setOpen(next)}}>
    <DialogTrigger asChild><Button variant="outline" size="sm"><Search size={15}/>{t('Search across servers')}</Button></DialogTrigger>
    <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-3xl" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{t('Search across servers')}</DialogTitle></DialogHeader>
      <form className="flex flex-wrap items-end gap-2" onSubmit={event=>{event.preventDefault();if(name.trim())void search(0,[])}}>
        <label className="grid gap-1 text-sm">{t('Platform')}<select className="rounded-md border border-input bg-background px-3 py-2" value={platform} onChange={event=>{clear();setPlatform(event.target.value as GlobalInventoryPlatform)}}>
          {platforms.map(p=><option key={p} value={p}>{label(p)}</option>)}
        </select></label>
        <label className="grid min-w-32 flex-1 gap-1 text-sm">{t('Object name')}<input className="rounded-md border border-input bg-background px-3 py-2" value={name} maxLength={200} onChange={event=>{clear();setName(event.target.value)}}/></label>
        <Button type="submit" disabled={!name.trim()||busy}>{t('Search')}</Button>
      </form>
      {error&&<p role="alert">{error}</p>}
      {busy&&<DataLoading compact status={t('Searching…')}/>}
      {page&&!busy&&<>
        {page.items.length ? <div className="overflow-auto"><table className={ops.table}><thead><tr><th>{t('Object name')}</th><th>{t('Object type')}</th><th>{t('vCenter / server')}</th></tr></thead>
          <tbody>{page.items.map(item=><tr key={itemKey(item)}><td>{item.name || item.objectId || t('Unnamed object')}</td><td>{label(item.type || 'Not reported')}</td><td>{item.hostName || t('Not reported')}</td></tr>)}</tbody></table></div>
          : <p>{t('No results found.')}</p>}
        <div className="flex items-center justify-end gap-2">
          {!!page.items.length&&<span className="mr-auto text-sm">{t('{start}–{end} of {count}',{start:formatNumber(page.skip+1),end:formatNumber(page.skip+page.items.length),count:formatNumber(page.total)})}</span>}
          <Button size="sm" variant="outline" disabled={!previous.length} onClick={()=>search(previous[previous.length-1],previous.slice(0,-1))}>{t('Previous')}</Button>
          <Button size="sm" variant="outline" disabled={!page.items.length||page.skip+page.items.length>=page.total} onClick={()=>search(page.skip+page.items.length,[...previous,page.skip])}>{t('Next')}</Button>
        </div>
      </>}
    </DialogContent>
  </Dialog>
}
