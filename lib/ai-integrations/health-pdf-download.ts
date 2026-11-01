import { createHealthPdf, healthPdfFonts, type HealthPdfOptions } from './health-pdf'

const fontCache = new Map<string, Promise<string>>()

function loadFont(name: string): Promise<string> {
  let pending = fontCache.get(name)
  if (!pending) {
    pending = (async () => {
      const response = await fetch(`/fonts/reports/${name}`, { signal: AbortSignal.timeout(30000), credentials: 'same-origin' })
      if (!response.ok) throw new Error('Unable to load PDF fonts')
      const bytes = new Uint8Array(await response.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
      return btoa(binary)
    })().catch(error => { fontCache.delete(name); throw error })
    fontCache.set(name, pending)
  }
  return pending
}

/** Called only after a user clicks Download; no new analysis or server-side report storage. */
export async function downloadHealthPdf(options: HealthPdfOptions) {
  const definition = createHealthPdf(options)
  const fonts = healthPdfFonts(options.completion + JSON.stringify(definition))
  const files = [...new Set(Object.values(fonts).flatMap(font => Object.values(font) as string[]))]
  const [module, entries] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    Promise.all(files.map(async file => [file, await loadFont(file)] as const)),
  ])
  const pdf = module.default
  pdf.addFonts(fonts)
  pdf.addVirtualFileSystem(Object.fromEntries(entries))
  const blob = await pdf.createPdf(definition).getBlob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const date = options.exportedAt
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  anchor.href = url
  anchor.download = `open-backup-ui-ai-summary-${stamp}.pdf`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Let browsers finish starting the download before releasing the object URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
}
