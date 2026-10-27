'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSectionNames } from '@/lib/context/section-names-context'
import { breadcrumbsForPath } from '@/lib/navigation/breadcrumbs'
import styles from './app-breadcrumbs.module.css'

export function AppBreadcrumbs() {
  const pathname=usePathname(),{sectionNames}=useSectionNames()
  const items=breadcrumbsForPath(pathname,sectionNames)
  if(!items.length)return null
  return <nav className={styles.trail} aria-label="Breadcrumb"><ol>{items.map((item,index)=><li key={`${index}-${item.label}`}>
    {index>0 && <span className={styles.separator} aria-hidden="true">/</span>}
    {item.href ? <Link href={item.href}>{item.label}</Link>:<span aria-current={index===items.length-1 ? 'page':undefined}>{item.label}</span>}
  </li>)}</ol></nav>
}
