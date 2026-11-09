'use client'
// Open Backup UI v1.0.2

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { defaultSectionNames, useSectionNames } from '@/lib/context/section-names-context'
import { useI18n } from '@/components/providers/i18n-provider'
import { breadcrumbsForPath } from '@/lib/navigation/breadcrumbs'
import styles from './app-breadcrumbs.module.css'

export function AppBreadcrumbs() {
  const pathname=usePathname(),{sectionNames}=useSectionNames()
  const { t } = useI18n()
  const items=breadcrumbsForPath(pathname,sectionNames)
  const section = pathname.split('/')[1] as keyof typeof defaultSectionNames
  const label = (value: string, index: number) => index === 0 && sectionNames[section] !== defaultSectionNames[section] ? value : t(value)
  if(!items.length)return null
  return <nav className={styles.trail} aria-label={t('Breadcrumb')}><ol>{items.map((item,index)=><li key={`${index}-${item.label}`}>
    {index>0 && <span className={styles.separator} aria-hidden="true">/</span>}
    {item.href ? <Link href={item.href}>{label(item.label,index)}</Link>:<span aria-current={index===items.length-1 ? 'page':undefined}>{label(item.label,index)}</span>}
  </li>)}</ol></nav>
}
