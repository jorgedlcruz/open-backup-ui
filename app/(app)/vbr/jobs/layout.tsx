'use client'
// Open Backup UI v1.3.0
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { observeJobSourceChanges } from '@/lib/job-builder/source-change'

export default function JobLayout({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState(0)
  useEffect(() => observeJobSourceChanges(() => setSelection(value => value + 1)), [])
  return <Fragment key={selection}>{children}</Fragment>
}
