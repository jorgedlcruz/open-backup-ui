'use client'

import { ChevronDown, Columns3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import styles from './grid-view-options.module.css'

export function GridViewOptions({ columns, visible, onChange, order }: {
  columns: { id: string; name: string }[]
  visible: string[]
  onChange: (columns: string[]) => void
  order?: { value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }
}) {
  return <Popover><PopoverTrigger asChild><Button size="sm" variant="ghost" aria-label="Grid view options"><Columns3 size={14} />View<ChevronDown size={12} /></Button></PopoverTrigger><PopoverContent align="end" className={styles.menu}>
    <strong className={styles.title}>Grid view</strong>
    <fieldset><legend>Visible columns</legend>{columns.map(column => <label key={column.id}><input type="checkbox" checked={visible.includes(column.id)} disabled={visible.length === 1 && visible.includes(column.id)} onChange={() => onChange(visible.includes(column.id) ? visible.filter(id => id !== column.id) : [...visible, column.id])} />{column.name}</label>)}</fieldset>
    {order && <label className={styles.order}><span>Default order</span><select aria-label="Grid default order" value={order.value} onChange={event => order.onChange(event.target.value)}>{order.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
  </PopoverContent></Popover>
}
