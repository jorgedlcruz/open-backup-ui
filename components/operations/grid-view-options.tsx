'use client'
// Open Backup UI v1.2.0

import { ChevronDown, Columns3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import styles from './grid-view-options.module.css'
import { useI18n } from '@/components/providers/i18n-provider'

export function GridViewOptions({ columns, visible, onChange, order }: {
  columns: { id: string; name: string }[]
  visible: string[]
  onChange: (columns: string[]) => void
  order?: { value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }
}) {
  const { t } = useI18n()
  return <Popover><PopoverTrigger asChild><Button size="sm" variant="ghost" aria-label={t('Grid view options')}><Columns3 size={14} />{t('View')}<ChevronDown size={12} /></Button></PopoverTrigger><PopoverContent align="end" className={styles.menu}>
    <strong className={styles.title}>{t('Grid view')}</strong>
    <fieldset><legend>{t('Visible columns')}</legend>{columns.map(column => <label key={column.id}><input type="checkbox" checked={visible.includes(column.id)} disabled={visible.length === 1 && visible.includes(column.id)} onChange={() => onChange(visible.includes(column.id) ? visible.filter(id => id !== column.id) : [...visible, column.id])} />{t(column.name)}</label>)}</fieldset>
    {order && <label className={styles.order}><span>{t('Default order')}</span><select aria-label={t('Grid default order')} value={order.value} onChange={event => order.onChange(event.target.value)}>{order.options.map(option => <option key={option.value} value={option.value}>{t(option.label)}</option>)}</select></label>}
  </PopoverContent></Popover>
}
