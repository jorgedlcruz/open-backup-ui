'use client'

import { Children, cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, RotateCcw } from 'lucide-react'
import { sortGridRows, sortKind, type GridOrder, type SortColumn } from '@/lib/grid-sort'
import { TableHead, TableBody } from './table'
import styles from './sortable-grid.module.css'

function text(node: ReactNode): string {
  return Children.toArray(node).map(child => typeof child === 'string' || typeof child === 'number' ? String(child) : isValidElement<{children?: ReactNode}>(child) ? text(child.props.children) : '').join(' ').trim()
}

/** Explicit raw values, sorted before the caller slices rows for local pagination. */
export function SortableGrid<T>({ rows, columns, children, onSortChange, groupBy, order: externalOrder, onOrderChange, manualSorting = false, scope = 'loaded records' }: {
  rows: readonly T[]
  columns: readonly (SortColumn<T> | null)[]
  children: (sorted: T[]) => ReactElement
  onSortChange?: () => void
  scope?: string
  groupBy?: (row: T) => string
  order?: GridOrder
  onOrderChange?: (order: GridOrder) => void
  manualSorting?: boolean
}) {
  const [localOrder, setLocalOrder] = useState<GridOrder>(null)
  const order = externalOrder === undefined ? localOrder : externalOrder
  const setOrder = (next: GridOrder) => { setLocalOrder(next); onOrderChange?.(next) }
  const active = order && columns.some(column => column?.id === order.id) ? order : null
  const sorted = manualSorting ? [...rows] : sortGridRows(rows, columns, active, groupBy)
  const activeColumn = active && columns.find(column => column?.id === active.id)
  const directionLabel = active && activeColumn && sortKind(rows, activeColumn) === 'date' ? active.direction === 'desc' ? 'newest first' : 'oldest first' : active?.direction === 'asc' ? 'ascending' : 'descending'
  let index = 0
  function decorate(node: ReactNode): ReactNode {
    return Children.map(node, child => {
      if (!isValidElement<Record<string, unknown>>(child)) return child
      if (child.type === 'tbody' || child.type === TableBody) return child
      if (child.type === 'th' || child.type === TableHead) {
        const column = columns[index++]
        if (!column) return child
        const label = text(child.props.children as ReactNode) || column.id
        const kind = sortKind(rows, column), first = kind === 'text' ? 'asc' : 'desc'
        const current = active?.id === column.id ? active.direction : null
        const next = current === null ? first : current === first ? first === 'asc' ? 'desc' : 'asc' : null
        const action = next === null ? 'Restore default order' : kind === 'date' ? next === 'desc' ? 'Newest first' : 'Oldest first' : next === 'asc' ? 'Ascending' : 'Descending'
        const Icon = current === 'asc' ? ArrowUp : current === 'desc' ? ArrowDown : ArrowUpDown
        return cloneElement(child, { scope: 'col', 'aria-sort': current === 'asc' ? 'ascending' : current === 'desc' ? 'descending' : 'none', children:
          <button type="button" className={styles.header} aria-label={`Sort by ${label}`} title={action} onClick={() => { setOrder(next ? { id: column.id, direction: next, label } : null); onSortChange?.() }}>
            {child.props.children as ReactNode}<Icon size={12} aria-hidden="true"/>
          </button> })
      }
      if (child.props.children) return cloneElement(child, { children: decorate(child.props.children as ReactNode) })
      return child
    })
  }
  return <>
    {active && <div className={styles.status} role="status">Sorted by {active.label} · {directionLabel} · {scope}<button type="button" onClick={() => { setOrder(null); onSortChange?.() }}><RotateCcw size={11}/>Reset order</button></div>}
    {decorate(children(sorted))}
  </>
}
