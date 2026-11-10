'use client'
// Open Backup UI v1.2.0
import { flexRender, type Header } from '@tanstack/react-table'
import type { ComponentProps } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { TableHead } from './table'
import styles from './sortable-grid.module.css'
import { useI18n } from '@/components/providers/i18n-provider'

export function SortableTableHead<T, V>({ header, native = false, ...props }: { header: Header<T, V>; native?: boolean } & ComponentProps<'th'>) {
  const { t } = useI18n()
  const column = header.column, direction = column.getIsSorted(), canSort = column.getCanSort()
  const Icon = direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ArrowUpDown
  const label = typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ')
  const next = column.getNextSortingOrder()
  const Head = native ? 'th' : TableHead
  const content = typeof column.columnDef.header === 'string' ? t(column.columnDef.header) : flexRender(column.columnDef.header, header.getContext())
  return <Head {...props} scope="col" aria-sort={canSort ? direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none' : undefined}>
    {!header.isPlaceholder && (canSort ? <button type="button" className={styles.header} aria-label={t('Sort by {column}', { column: t(label) })} title={t(next === false ? 'Restore default order' : next === 'asc' ? 'Ascending / oldest first' : 'Descending / newest first')} onClick={() => { column.toggleSorting(); header.getContext().table.setPageIndex(0) }}>
      {content}<Icon size={12} aria-hidden="true"/>
    </button> : content)}
  </Head>
}
