'use client'
// Open Backup UI v1.0.2

import { useRef, useState } from 'react'
import { Download, FileDown, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useI18n } from '@/components/providers/i18n-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import styles from './ai-health-summary.module.css'

export function HealthPdfExport({ completion, generatedAt, disabled }: { completion: string; generatedAt?: Date; disabled: boolean }) {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const [paper, setPaper] = useState<'A4' | 'LETTER'>('A4')
  const [includeNotes, setIncludeNotes] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const exporting = useRef(false)
  const download = async () => {
    if (exporting.current || disabled) return
    exporting.current = true
    setBusy(true); setFailed(false)
    try {
      const { downloadHealthPdf } = await import('@/lib/ai-integrations/health-pdf-download')
      await downloadHealthPdf({ completion, generatedAt, exportedAt: new Date(), locale, t, paper, includeNotes })
      toast.success(t('PDF ready'))
      setOpen(false)
    } catch {
      setFailed(true)
    } finally {
      exporting.current = false
      setBusy(false)
    }
  }
  return <Dialog open={open} onOpenChange={value => { if (!busy) { setOpen(value); setFailed(false) } }}>
    <DialogTrigger asChild><Button variant="outline" size="sm" disabled={disabled}><FileDown size={14} aria-hidden="true" />{t('Export PDF')}</Button></DialogTrigger>
    <DialogContent className={styles.exportDialog} showCloseButton={!busy}>
      <DialogHeader><DialogTitle>{t('Export AI summary')}</DialogTitle><DialogDescription>{t('A designed report of every summary section. No new AI request.')}</DialogDescription></DialogHeader>
      <div className={styles.exportPreview} aria-hidden="true">
        <div className={styles.paperPreview}><span><ShieldCheck size={17} />Open Backup UI</span><small>{t('Protection Lens')}</small><strong>{t('AI health summary')}</strong><i /><p>{t('Point-in-time AI analysis')}</p><div /><div /><div /></div>
        <div className={styles.exportFeatures}><FileDown size={25} strokeWidth={1.5} /><strong>{t('Made for sharing')}</strong><p>{t('Cover, linked contents, all sections and page numbers. Selectable text with embedded fonts.')}</p></div>
      </div>
      <div className={styles.exportOptions}>
        <label>{t('Paper size')}<select value={paper} onChange={event => setPaper(event.target.value as 'A4' | 'LETTER')} disabled={busy}><option value="A4">A4</option><option value="LETTER">US Letter</option></select></label>
        <label className={styles.exportCheck}><input type="checkbox" checked={includeNotes} onChange={event => setIncludeNotes(event.target.checked)} disabled={busy} /><span>{t('Include analysis notes')}<small>{t('Adds the expandable AI reasoning shown beneath each section.')}</small></span></label>
      </div>
      {failed && <p className={styles.exportError} role="alert">{t('The PDF could not be created. Check your connection to the app and try again.')}</p>}
      <DialogFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>{t('Cancel')}</Button><Button onClick={() => void download()} disabled={busy || disabled}>{busy ? <Loader2 size={15} className={styles.spinner} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}{t(busy ? 'Preparing PDF...' : 'Download PDF')}</Button></DialogFooter>
      {busy && <span role="status" className="sr-only">{t('Preparing PDF...')}</span>}
    </DialogContent>
  </Dialog>
}
