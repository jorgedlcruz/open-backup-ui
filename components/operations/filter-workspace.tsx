'use client'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PanelLeft } from 'lucide-react'
import { useId,useState,type ReactNode } from 'react'
import styles from './filter-workspace.module.css'

/** One search row, an optional push-in filter rail, and no repeated filter chips. */
export function FilterWorkspace({ search, filters, children, actions, activeCount, onClear, label, initiallyOpen = false }: {
  search?: ReactNode
  filters: ReactNode
  children: ReactNode
  actions?: ReactNode
  activeCount?: number
  onClear: () => void
  label: string
  initiallyOpen?: boolean
}) {
  const id = useId()
  const [open, setOpen] = useState(initiallyOpen)
  return <div className={styles.workspace}>
    <div className={styles.toolbar}>
      {search && <div className={styles.search}>{search}</div>}
      <div className={styles.filterActions}>
        {filters && <Button variant="outline" size="sm" aria-expanded={open} aria-controls={`${id}-filters`} title={open ? 'Hide filters' : 'Show filters'} onClick={() => setOpen(value => !value)}><PanelLeft size={14} />Filters{activeCount !== undefined && activeCount > 0 && <span className={styles.count}>{activeCount}</span>}</Button>}
        <Button variant="ghost" size="sm" disabled={activeCount === 0} onClick={onClear}>Clear all</Button>
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
    <div className={cn(styles.split, open && styles.open)}>
      {filters && <aside hidden={!open} id={`${id}-filters`} className={styles.rail} aria-label={label}>{filters}</aside>}
      <div className={styles.results}>{children}</div>
    </div>
  </div>
}
