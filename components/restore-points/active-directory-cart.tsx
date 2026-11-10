'use client'
// Open Backup UI v1.2.0

import { useState } from 'react'
import { FileOutput, FileText, Folder, RotateCcw, Search, ShoppingCart, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import type { AdEntry } from '@/lib/restore-points/ad-client'
import { useRecoveryPresentation } from './use-presentation'
import styles from './active-directory.module.css'

type CartProps = {
  items: AdEntry[]
  open: boolean
  ready: boolean
  busy: boolean
  error: string
  onOpenChange: (open: boolean) => void
  setItems: (items: AdEntry[]) => void
  launch: (intent: 'export' | 'restore') => void
}

export function DirectoryCart({items, open, ready, busy, error, onOpenChange, setItems, launch}: CartProps) {
  const {t, formatNumber} = useRecoveryPresentation()
  const [query, setQuery] = useState('')
  const [cleared, setCleared] = useState<AdEntry[]>()
  const search = query.trim().toLocaleLowerCase()
  const shown = items.filter(row => [row.name, row.itemType, row.containerType].some(value => value?.toLocaleLowerCase().includes(search)))

  return <Sheet open={open} onOpenChange={next => { setQuery(''); setCleared(undefined); onOpenChange(next) }}>
    <SheetTrigger asChild>
      <Button type="button" size="sm" variant="outline" disabled={!ready}>
        <ShoppingCart/>{t('Recovery cart')}<span className={styles.cartCount}>{formatNumber(items.length)}</span>
      </Button>
    </SheetTrigger>
    <SheetContent className={styles.cartPanel}>
      <SheetHeader className={styles.cartHeader}>
        <SheetTitle className={styles.cartTitle}><ShoppingCart size={18}/>{t('Recovery cart')}</SheetTitle>
        <div className={styles.cartSummary}>
          <SheetDescription aria-live="polite">{t('{count} items',{count:formatNumber(items.length)})}</SheetDescription>
          {!!items.length && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => {
            setCleared(items)
            setItems([])
            setQuery('')
          }}>{t('Remove all')}</Button>}
          {!!cleared && !items.length && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => {
            setItems(cleared)
            setCleared(undefined)
          }}>{t('Undo')}</Button>}
        </div>
      </SheetHeader>
      <div className={styles.cartBody}>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <label className={styles.cartSearch}>
          <Search size={15} aria-hidden/>
          <input type="search" placeholder={t('Search cart')} aria-label={t('Search cart')} value={query} onChange={e=>setQuery(e.target.value)}/>
        </label>
        {shown.length ? <ul className={styles.cartList}>{shown.map(row => {
          const Icon = row.type === 'container' ? Folder : FileText
          return <li key={row.dnt}>
            <Icon size={16}/>
            <span><strong>{row.name}</strong><small>{row.itemType || row.containerType || t('Directory objects')}</small></span>
            <Button type="button" size="icon-sm" variant="ghost" disabled={busy} aria-label={t('Remove {name}',{name:row.name})}
              onClick={()=>setItems(items.filter(item=>item.dnt!==row.dnt))}>
              <X size={15}/>
            </Button>
          </li>
        })}</ul> : <p role="status" className={styles.quiet}>{items.length ? t('No matches') : t('The cart is empty.')}</p>}
      </div>
      <SheetFooter className={styles.cartFooter}>
        <Button type="button" variant="outline" disabled={busy||!items.length} onClick={()=>launch('export')}><FileOutput/>{t('Export')}</Button>
        <Button type="button" disabled={busy||!items.length} onClick={()=>launch('restore')}><RotateCcw/>{t('Restore')}</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
}
