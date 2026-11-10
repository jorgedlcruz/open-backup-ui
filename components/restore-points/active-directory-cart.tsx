'use client'
// Open Backup UI v1.0.2
import {useState} from 'react'
import {FileText,Folder,ShoppingCart,X} from 'lucide-react'
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog'
import {Button} from '@/components/ui/button'
import type {AdEntry} from '@/lib/restore-points/ad-client'
import {useRecoveryPresentation} from './use-presentation'
import styles from './active-directory.module.css'

export function DirectoryCart({items,close,remove,launch,busy}:{items:AdEntry[];close:()=>void;remove:(row:AdEntry)=>void;launch:(intent:'export'|'restore')=>void;busy:boolean}){
  const {t,formatNumber}=useRecoveryPresentation(),[query,setQuery]=useState('')
  const search=query.trim().toLocaleLowerCase()
  const shown=items.filter(row=>[row.name,row.itemType,row.containerType].some(v=>v?.toLocaleLowerCase().includes(search)))
  return <Dialog open onOpenChange={open=>{if(!open)close()}}><DialogContent className={styles.dialog}>
    <DialogHeader><DialogTitle className={styles.cartTitle}><ShoppingCart size={18}/>{t('Recovery cart')}</DialogTitle>
      <DialogDescription>{t('{count} items',{count:formatNumber(items.length)})}</DialogDescription></DialogHeader>
    <input type="search" className={styles.cartSearch} placeholder={t('Search cart')} aria-label={t('Search cart')} value={query} onChange={e=>setQuery(e.target.value)}/>
    <ul className={styles.cartList}>{shown.map(row=><li key={row.dnt}>{row.type==='container'?<Folder size={16}/>:<FileText size={16}/>}
      <span><strong>{row.name}</strong><small>{row.itemType||row.containerType||t('Directory objects')}</small></span>
      <Button size="icon-sm" variant="ghost" disabled={busy} aria-label={t('Remove {name}',{name:row.name})} onClick={()=>remove(row)}><X size={15}/></Button></li>)}</ul>
    {!shown.length&&<p className={styles.quiet}>{items.length?t('No matches'):t('The cart is empty.')}</p>}
    <div className={styles.actions}><Button variant="outline" disabled={busy||!items.length} onClick={()=>launch('export')}>{t('Export')}</Button>
      <Button disabled={busy||!items.length} onClick={()=>launch('restore')}>{t('Restore')}</Button></div>
  </DialogContent></Dialog>
}
