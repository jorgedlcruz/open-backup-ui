'use client'
// Open Backup UI v1.0.2

import { Button } from '@/components/ui/button'
import { Popover,PopoverContent,PopoverTrigger } from '@/components/ui/popover'
import { ChevronDown,Columns3 } from 'lucide-react'
import { Children,isValidElement,type ReactElement,type ReactNode,type SyntheticEvent } from 'react'
import { FilterFacet } from './filter-facet'
import styles from './filter-fields.module.css'
import { useI18n } from '@/components/providers/i18n-provider'

export function FilterFields({ children }: { children: ReactNode }) {
  return <div className={styles.fields}>{children}</div>
}

// Keep each existing preset's handler and count, presented as one compact field.
// The children are native buttons so the caller retains its typed filter values.
type Choice = { children?: ReactNode; 'aria-pressed'?: boolean; onClick?: () => void; disabled?: boolean }
function optionText(node: ReactNode): string {
  return Children.toArray(node).map(child => typeof child === 'string' || typeof child === 'number' ? String(child) : isValidElement<{ children?: ReactNode }>(child) ? optionText(child.props.children) : '').filter(Boolean).join(' ')
}
export function FilterCondition({ children, label = 'Condition' }: { children: ReactNode; label?: string }) {
  const { t } = useI18n()
  const choices = Children.toArray(children).filter((child): child is ReactElement<Choice> => isValidElement<Choice>(child) && child.type === 'button')
  const selected = choices.findIndex(child => child.props['aria-pressed'])
  return <FilterFacet title={label} multiple={false} defaultOpen options={choices.map((child, index) => {
    const parts = Children.toArray(child.props.children)
    const last = parts[parts.length - 1]
    const countText = isValidElement<{ children?: ReactNode }>(last) && last.type === 'span' ? optionText(last.props.children) : ''
    const hasCount = /^[\p{Nd}.,\s\u066c]+$/u.test(countText) && /\p{Nd}/u.test(countText)
    // The caller may already have localized grouping/digits. Keep that display
    // separate from the option value instead of parsing it as an English number.
    return { value: String(index), label: t(optionText(hasCount ? parts.slice(0, -1) : parts)), countText: hasCount ? countText : undefined, disabled: child.props.disabled }
  })} selected={selected < 0 ? [] : [String(selected)]} onChange={values => choices[Number(values[0])]?.props.onClick?.()} />
}

export function GridViewMenu({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  return <Popover><PopoverTrigger asChild><Button variant="ghost" size="sm" aria-label={t('Grid view options')}><Columns3 size={14} />{t('View')}<ChevronDown size={12} /></Button></PopoverTrigger><PopoverContent align="end" className={styles.view}><strong>{t('Grid view')}</strong><FilterFields>{children}</FilterFields></PopoverContent></Popover>
}

export function GridColumnFields({ columns, visible, onChange }: { columns: { id: string; name: string }[]; visible: string[]; onChange: (columns: string[]) => void }) {
  const { t } = useI18n()
  return <fieldset className={styles.columns}><legend>{t('Visible columns')}</legend>{columns.map(column => <GridColumnChoice key={column.id} checked={visible.includes(column.id)} disabled={visible.length === 1 && visible.includes(column.id)} onCheckedChange={() => onChange(visible.includes(column.id) ? visible.filter(id => id !== column.id) : [...visible, column.id])}>{t(column.name)}</GridColumnChoice>)}</fieldset>
}

export function GridColumnChoice({ children, checked, disabled, onCheckedChange }: { children: ReactNode; checked?: boolean | 'indeterminate'; disabled?: boolean; className?: string; onCheckedChange: (checked: boolean) => void; onSelect?: (event: SyntheticEvent) => void }) {
  return <label className={styles.column}><input type="checkbox" checked={checked === true} disabled={disabled} onChange={event => onCheckedChange(event.target.checked)} />{children}</label>
}
