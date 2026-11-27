'use client'
// Open Backup UI v1.3.0
import { useEffect, useId, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataLoading } from '@/components/ui/data-loading'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useI18n } from '@/components/providers/i18n-provider'
import type { RecoveryItem } from '@/lib/vbm-recovery/model'
import type { MessageBody } from '@/lib/vbm-recovery/message-reader'
import { mailPreviewDocument } from '@/lib/vbm-recovery/mail-preview-document'
import { previewLimit, previewMedia } from '@/lib/vbm-recovery/content-types'
import { formatBytes } from '@/lib/restore-points/model'

type Preview = {text:string;truncated?:boolean}|{document:string;truncated:boolean}|{url:string;type:string}|{error:string}

export function ContentPane({item,sessionId,onClose}:{item:RecoveryItem;sessionId:string;onClose:()=>void}) {
  const {t,formatDate}=useI18n()
  const [preview,setPreview]=useState<Preview>(),[downloadError,setDownloadError]=useState('')
  const frame=useId()
  const {workload,id,ownerId,kind,channelId}=item
  const mail=workload==='Exchange',media=previewMedia(item.name)
  const large=typeof item.sizeBytes==='number' && item.sizeBytes>previewLimit
  const supported=!!(mail || media) && !large
  const attachments=Array.isArray(item.raw.attachments)?item.raw.attachments:[]
  useEffect(()=>{
    if(!supported)return
    const controller=new AbortController()
    let objectUrl:string|undefined
    async function read() {
      try {
        const response=await fetch('/api/vbm/recovery',{
          method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',signal:controller.signal,
          body:JSON.stringify({action:'viewContent',sessionId,workload,id,ownerId,kind,channelId}),
        })
        if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error || 'Preview unavailable')
        let next:Preview
        if(mail) {
          const message:MessageBody=await response.json()
          next=message.format==='unavailable'?{error:'Download the original to open this item.'}
            :message.format==='html'?{document:mailPreviewDocument(message.content),truncated:message.truncated}
            :{text:message.content,truncated:message.truncated}
        }else{
          const type=response.headers.get('content-type')?.split(';')[0]
          if(!type || type!==media)throw new Error('Preview unavailable')
          const blob=await response.blob()
          if(controller.signal.aborted)return
          if(type==='text/plain'){
            const bytes=new Uint8Array(await blob.arrayBuffer())
            const encoding=bytes[0]===0xff&&bytes[1]===0xfe?'utf-16le':bytes[0]===0xfe&&bytes[1]===0xff?'utf-16be':'utf-8'
            const max=1024*1024
            next={text:new TextDecoder(encoding).decode(bytes.subarray(0,max)),truncated:bytes.length>max}
          }else{
            objectUrl=URL.createObjectURL(blob)
            next={url:objectUrl,type}
          }
        }
        if(!controller.signal.aborted)setPreview(next)
      }catch(error){if(!controller.signal.aborted)setPreview({error:error instanceof Error?error.message:'Preview unavailable'})}
    }
    const start=setTimeout(()=>void read(),0)
    return ()=>{clearTimeout(start);controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl)}
  },[sessionId,workload,id,ownerId,kind,channelId,mail,media,supported])

  const fields=['from','to','cc','bcc','sent','received','importance'] as const
  const labels={from:'From',to:'To',cc:'Cc',bcc:'Bcc',sent:'Sent',received:'Received',importance:'Importance'}
  return <Sheet open onOpenChange={open=>{if(!open)onClose()}}>
    <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-[min(46rem,90vw)]">
      <SheetHeader className="shrink-0 border-b pr-12">
        <SheetDescription>{t('Preview')} · {workload}</SheetDescription>
        <SheetTitle className="break-words">{item.name}</SheetTitle>
      </SheetHeader>
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
        {mail&&<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">{fields.map(key=>{
          const value=item.raw[key]
          if(typeof value!=='string'||!value)return null
          const date=['sent','received'].includes(key)&&Number.isFinite(Date.parse(value))
          return <div className="contents" key={key}><dt className="text-muted-foreground">{t(labels[key])}</dt><dd className="break-words">{date?formatDate(value,{dateStyle:'medium',timeStyle:'short'}):value}</dd></div>
        })}</dl>}
        {!!attachments.length&&<div><strong className="text-sm">{t('Attachments')}</strong><ul className="list-inside list-disc break-words text-sm">{attachments.map((a:unknown,i:number)=>{
          if(!a||typeof a!=='object'||!('name' in a)||typeof a.name!=='string')return null
          return <li key={i}>{a.name}{'sizeBytes' in a && typeof a.sizeBytes==='number' && ` (${formatBytes(a.sizeBytes)})`}</li>
        })}</ul></div>}
        <form action="/api/vbm/recovery" method="post" target={frame} onSubmit={()=>setDownloadError('')}>
          {Object.entries({action:'downloadOriginal',sessionId,workload,id,ownerId,kind,channelId}).map(([key,value])=>value&&<input key={key} type="hidden" name={key} value={value}/>)}
          <Button type="submit" size="sm" variant="outline"><Download/>{t('Download original')}</Button>
        </form>
        <iframe hidden name={frame} title={t('Download original')} onLoad={event=>{
          try {
            const text=event.currentTarget.contentDocument?.body.textContent
            if(text)setDownloadError(JSON.parse(text).error||'Preview unavailable')
          }catch{setDownloadError('Preview unavailable')}
        }}/>
        {downloadError&&<p role="alert">{t(downloadError)}</p>}
        {!supported?<p>{t(large?'This item is too large for inline viewing. Download the original to open it.':'Download the original to open this item.')}</p>
          :!preview?<DataLoading status={t('Loading preview…')} compact/>
          :'error' in preview?<p role="status">{t(preview.error)}</p>
          :'document' in preview?<iframe title={item.name} sandbox="" referrerPolicy="no-referrer" srcDoc={preview.document}
            className="block min-h-60 w-full flex-1 rounded-md border bg-white"/>
          :'text' in preview?<pre className="max-h-[65dvh] overflow-auto whitespace-pre-wrap wrap-anywhere rounded-md border p-4 font-sans text-sm">{preview.text}</pre>
          :preview.type==='application/pdf'?<object type="application/pdf" data={preview.url} className="h-[66vh] w-full" aria-label={item.name}>{t('Download the original to open this item.')}</object>
          // The image is a private in-memory object URL, unavailable to the image optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          :<img src={preview.url} alt={item.name} className="max-h-[70vh] max-w-full object-contain"/>}
        {preview && 'truncated' in preview && preview.truncated && <small>{t('Preview shortened. Download the original for the full content.')}</small>}
      </div>
    </SheetContent>
  </Sheet>
}
