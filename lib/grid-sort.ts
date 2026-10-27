export type SortKind = 'text' | 'number' | 'date' | 'auto'
export type SortDirection = 'asc' | 'desc'
export type SortColumn<T> = { id: string; value: (row: T) => unknown; kind?: SortKind }
export type GridOrder = { id: string; direction: SortDirection; label: string } | null
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const isoDate = /^\d{4}-\d{2}-\d{2}(?:[Tt ][\d:.]+(?:[Zz]|[+-]\d{2}:?\d{2})?)?$/

export function dateSortValue(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !isoDate.test(value.trim())) return null
  const text = value.trim(), year = Number(text.slice(0, 4)), month = Number(text.slice(5, 7)), day = Number(text.slice(8, 10))
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null
  const timestamp = Date.parse(text)
  return Number.isFinite(timestamp) ? timestamp : null
}
export function scalarSortValue(value: unknown): unknown {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const record = value as Record<string, unknown>
    if ('value' in record) return scalarSortValue(record.value)
    return null
  }
  return value
}
export function sortKind<T>(rows: readonly T[], column: SortColumn<T>): Exclude<SortKind, 'auto'> {
  if (column.kind && column.kind !== 'auto') return column.kind
  const values = rows.map(row => scalarSortValue(column.value(row))).filter(v => v !== null && v !== undefined && v !== '')
  if (values.length && values.every(v => typeof v === 'number' || typeof v === 'boolean')) return 'number'
  if (values.length && values.every(v => v instanceof Date || typeof v === 'string' && isoDate.test(v.trim()))) return 'date'
  return 'text'
}
export function compareSortValues(a: unknown, b: unknown, kind: Exclude<SortKind, 'auto'>, direction: SortDirection): number {
  const normalized = (raw: unknown): string | number | null => {
    const value = scalarSortValue(raw)
    if (value === null || value === undefined || value === '') return null
    if (kind === 'date') return dateSortValue(value)
    if (kind === 'number') return typeof value === 'boolean' ? Number(value) : typeof value === 'number' && Number.isFinite(value) ? value : null
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : null
  }
  const left = normalized(a), right = normalized(b)
  // Missing evidence stays at the bottom in both directions.
  if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1
  const result = typeof left === 'number' && typeof right === 'number' ? left - right : collator.compare(String(left), String(right))
  return direction === 'asc' ? result : -result
}
export function sortGridRows<T>(rows: readonly T[], columns: readonly (SortColumn<T> | null)[], order: GridOrder, groupBy?: (row: T) => string): T[] {
  const column = order && columns.find(c => c?.id === order.id)
  if (!column || !order) return [...rows]
  if (groupBy) {
    const groups = new Map<string, T[]>()
    for (const row of rows) { const key = groupBy(row); if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(row) }
    return [...groups.values()].flatMap(group => sortGridRows(group, columns, order))
  }
  const kind = sortKind(rows, column)
  return rows.map((row, index) => ({ row, index, value: column.value(row) }))
    .sort((a, b) => compareSortValues(a.value, b.value, kind, order.direction) || a.index - b.index).map(item => item.row)
}
