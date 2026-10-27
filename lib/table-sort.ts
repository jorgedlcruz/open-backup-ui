import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { compareSortValues, sortKind } from './grid-sort'

/** Keep display/accessor values intact, but compare dates and missing evidence consistently. */
export function sortableColumns<T>(columns: ColumnDef<T>[], sorting: SortingState, data: readonly T[]): ColumnDef<T>[] {
  return columns.map(column => {
    const key = 'accessorKey' in column ? String(column.accessorKey) : column.id || ''
    const id = column.id || key.replaceAll('.', '_')
    const accessor = 'accessorFn' in column ? column.accessorFn : (row: T) => key.split('.').reduce<unknown>((value, part) => value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined, row)
    if ((!key && !('accessorFn' in column)) || column.enableSorting === false) return column
    const values = data.map((row, index) => accessor(row, index))
    const kind = sortKind(values, { id, value: value => value, kind: /(?:date|time|lastRun|nextRun)/i.test(key) ? 'date' : 'auto' })
    const direction = sorting.find(item => item.id === id)?.desc ? 'desc' : 'asc'
    return { ...column, sortUndefined: false, sortDescFirst: kind !== 'text', sortingFn: (a, b, columnId) => {
      // TanStack applies its direction after this callback. Cancel that flip for null placement.
      const result = compareSortValues(a.getValue(columnId), b.getValue(columnId), kind, direction)
      return direction === 'desc' ? -result : result
    } }
  })
}
