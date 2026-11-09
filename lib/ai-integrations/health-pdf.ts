// Open Backup UI v1.0.2
import type { Content, ContentStack, ContentText, Style, TDocumentDefinitions, TFontDictionary } from 'pdfmake/interfaces'
import type { Root, RootContent, PhrasingContent } from 'mdast'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Locale } from '../i18n/model'
import type { Translator } from '../i18n/presentation'
import { healthAlertPrefix, healthConfidence, healthSectionTitle } from './health-presentation'
import { readHealthSections } from './health-sections'

const ink = '#142C3D', muted = '#526A79', accent = '#087F8C', line = '#DCE6E9'
const cjk = /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef\u{20000}-\u{3134f}]/u
const hindi = /[\u0900-\u097f\u1cd0-\u1cff\ua8e0-\ua8ff]/u
const parser = unified().use(remarkParse).use(remarkGfm)

export type HealthPdfOptions = {
  completion: string
  locale: Locale
  t: Translator
  generatedAt?: Date
  exportedAt: Date
  paper: 'A4' | 'LETTER'
  includeNotes: boolean
}

/** Fonts are bundled with the app; no telemetry, text or font requests go to a third party. */
export function healthPdfFonts(text: string): TFontDictionary {
  const fonts: TFontDictionary = { Report: { normal: 'NotoSans-Regular.ttf', bold: 'NotoSans-Bold.ttf', italics: 'NotoSans-Italic.ttf', bolditalics: 'NotoSans-BoldItalic.ttf' } }
  if (cjk.test(text)) fonts.ReportCJK = { normal: 'NotoSansCJKjp-Regular.otf', bold: 'NotoSansCJKjp-Regular.otf', italics: 'NotoSansCJKjp-Regular.otf', bolditalics: 'NotoSansCJKjp-Regular.otf' }
  if (hindi.test(text)) fonts.ReportHindi = { normal: 'NotoSansDevanagari-Regular.ttf', bold: 'NotoSansDevanagari-Bold.ttf', italics: 'NotoSansDevanagari-Regular.ttf', bolditalics: 'NotoSansDevanagari-Bold.ttf' }
  return fonts
}

export function safeReportLink(value: string): string | undefined {
  try { const url = new URL(value); return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? value : undefined } catch { return undefined }
}

/** Script-aware runs retain multilingual names, even inside an otherwise English report. */
function runs(value: string, style: Style = {}): ContentText[] {
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[^\s\u200b]{32,}/gu, word => Array.from(word).map((character, i) => (i && i % 24 === 0 ? '\u200b' : '') + character).join(''))
  const groups: { font: string; text: string }[] = []
  for (const char of text) {
    const font = /[\u200c\u200d]/.test(char) ? groups.at(-1)?.font || 'Report' : cjk.test(char) ? 'ReportCJK' : hindi.test(char) ? 'ReportHindi' : 'Report'
    if (groups.at(-1)?.font === font) groups[groups.length - 1].text += char
    else groups.push({ font, text: char })
  }
  return groups.map(group => ({ ...style, ...group }))
}

function plain(node: RootContent | PhrasingContent): string {
  if ('value' in node) return node.value
  if ('children' in node) return node.children.map(child => plain(child as RootContent)).join('')
  if (node.type === 'image' || node.type === 'imageReference') return node.alt || ''
  return ''
}

export function healthMarkdownPdf(markdown: string, t: Translator): Content[] {
  const root = parser.parse(markdown) as Root
  const definitions = new Map(root.children.filter(node => node.type === 'definition').map(node => [node.identifier, node.url]))
  function inline(nodes: PhrasingContent[], style: Style = {}): ContentText[] {
    return nodes.flatMap((node): ContentText[] => {
      if (node.type === 'text') return runs(node.value, style)
      if (node.type === 'break') return [{ text: '\n' }]
      if (node.type === 'strong') return inline(node.children, { ...style, bold: true })
      if (node.type === 'emphasis') return inline(node.children, { ...style, italics: true })
      if (node.type === 'delete') return inline(node.children, { ...style, decoration: 'lineThrough' })
      if (node.type === 'inlineCode') return runs(node.value, { ...style, color: accent, background: '#EFF5F5' })
      if (node.type === 'link' || node.type === 'linkReference') {
        const link = safeReportLink(node.type === 'link' ? node.url : definitions.get(node.identifier) || '')
        return inline(node.children, { ...style, ...(link ? { color: accent, decoration: 'underline' as const } : {}) }).map(run => ({ ...run, ...(link ? { link } : {}) }))
      }
      if (node.type === 'image' || node.type === 'imageReference') return runs(node.alt || '', style)
      // Raw HTML is never executed or treated as a remote image/font source.
      return []
    })
  }
  function blocks(nodes: RootContent[]): Content[] {
    return nodes.flatMap((node): Content[] => {
      if (node.type === 'paragraph') {
        const content = inline(node.children)
        const text = plain(node).trim()
        const urgent = /^(?:Urgent):/i.test(text) || text.startsWith(t('Urgent:'))
        const recommendation = /^Recommendation:/i.test(text) || text.startsWith(t('Recommendation:'))
        if (urgent || recommendation) {
          // Localize only the protocol marker, preserving the actual evidence.
          if (content[0]) content[0].text = healthAlertPrefix(t, String(content[0].text))
          return [{ table: { widths: ['*'], dontBreakRows: text.length < 900, body: [[{ text: content, color: urgent ? '#852E39' : ink, margin: [13, 11, 13, 11] }]] },
            layout: { fillColor: () => urgent ? '#FDF0F0' : '#EAF6F4', hLineWidth: () => 0, vLineWidth: i => i === 0 ? 3 : 0, vLineColor: () => urgent ? '#BD4352' : accent, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 }, margin: [0, 6, 0, 16] }]
        }
        return [{ text: content, margin: [0, 0, 0, 12] }]
      }
      if (node.type === 'heading') return [{ text: inline(node.children), fontSize: node.depth <= 2 ? 16 : 12, bold: true, color: ink, headlineLevel: 2, margin: [0, 12, 0, 9] }]
      if (node.type === 'list') {
        const items: Content[] = node.children.map(item => ({ stack: [ ...(item.checked === null || item.checked === undefined ? [] : [{ text: item.checked ? '[x]' : '[ ]', color: accent }]), ...blocks(item.children)], margin: [0, 0, 0, 3] }))
        return [{ ...(node.ordered ? { ol: items, start: node.start || 1 } : { ul: items }), margin: [12, 0, 0, 12], markerColor: accent }]
      }
      if (node.type === 'blockquote') return [{ stack: blocks(node.children), margin: [14, 4, 8, 10], color: muted, italics: true }]
      if (node.type === 'code') return [{ text: runs(node.value), fontSize: 9, color: accent, margin: [12, 8, 12, 16], preserveLeadingSpaces: true }]
      if (node.type === 'thematicBreak') return [{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineColor: line, lineWidth: 1 }], margin: [0, 8, 0, 16] }]
      if (node.type === 'table') {
        const columns = Math.max(...node.children.map(row => row.children.length))
        return [{ table: { headerRows: 1, keepWithHeaderRows: 1, widths: Array(columns).fill('*'), body: node.children.map((row, index) => Array.from({ length: columns }, (_, column) => ({
          text: inline(row.children[column]?.children || []), bold: index === 0, color: index === 0 ? ink : muted, alignment: node.align?.[column] || 'left', margin: [0, 3, 0, 3],
        }))) }, fontSize: columns > 4 ? 8 : 9, lineHeight: 1.25,
        layout: { fillColor: i => i === 0 ? '#EAF2F4' : i % 2 === 0 ? '#F6F9FA' : null, hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => line, paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 7, paddingBottom: () => 7 }, margin: [0, 3, 0, 18] }]
      }
      return []
    })
  }
  return blocks(root.children)
}

const reportMark = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="10" fill="#DCF5F1"/><path d="M16 6l9 4v7c0 5-9 10-9 10S7 22 7 17v-7z" fill="none" stroke="#087F8C" stroke-width="1.7"/><path d="M12 16l3 3 6-7" fill="none" stroke="#087F8C" stroke-width="1.7"/></svg>'

export function createHealthPdf(options: HealthPdfOptions): TDocumentDefinitions {
  const { completion, locale, t, generatedAt, exportedAt, paper, includeNotes } = options
  const sections = readHealthSections(completion, t('Overview')).filter(section => section.content.trim())
  if (!sections.length) throw new Error('A completed summary is required for PDF export.')
  const width = paper === 'LETTER' ? 612 : 595.28
  const contentWidth = width - 96
  const date = (value: Date) => new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(value)
  const title = t('AI health summary')
  const text = (value: string, style: Style & Pick<ContentText, 'pageBreak' | 'headlineLevel'> = {}): ContentText => ({ text: runs(value), ...style })
  const content: Content[] = [
    { columns: [{ svg: reportMark, width: 32 }, text('Open Backup UI', { fontSize: 13, bold: true, margin: [10, 7, 0, 0] })], margin: [0, 2, 0, 58] },
    text(t('Protection Lens'), { fontSize: 10, bold: true, color: accent, characterSpacing: 1.5, margin: [0, 0, 0, 16] }),
    text(title, { fontSize: 44, bold: true, lineHeight: 1.05, color: ink, margin: [0, 0, 65, 20] }),
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 56, y2: 0, lineColor: accent, lineWidth: 4 }], margin: [0, 0, 0, 20] },
    text(t('Operational health, security posture and audit activity.'), { fontSize: 13, color: muted, margin: [0, 0, 85, 28] }),
    { columns: [
      { width: '*', stack: [text(t(generatedAt ? 'Summary generated' : 'Exported'), { fontSize: 8, color: muted, margin: [0, 0, 0, 5] }), text(date(generatedAt || exportedAt), { fontSize: 10, bold: true })] },
      { width: 135, stack: [text(t('Report contents'), { fontSize: 8, color: muted, margin: [0, 0, 0, 5] }), text(t('{count} sections', { count: new Intl.NumberFormat(locale).format(sections.length) }), { fontSize: 10, bold: true })] },
    ], margin: [0, 0, 0, 34] },
    { toc: { title: text(t('In this report'), { fontSize: 10, bold: true, color: accent, margin: [0, 0, 0, 12] }), textStyle: { fontSize: 11, color: ink }, numberStyle: { fontSize: 11, color: accent, bold: true }, textMargin: [0, 7, 0, 7] } },
    text(t('Point-in-time AI analysis'), { fontSize: 9, color: muted, margin: [0, 30, 0, 0] }),
  ]
  sections.forEach((section, index) => {
    const [name, confidenceMarker] = section.title.split('|')
    const heading = healthSectionTitle(t, name.trim())
    const confidence = confidenceMarker ? healthConfidence(t, confidenceMarker, locale) : null
    const sectionHeader: ContentStack & { id: string } = { id: `health-start-${index}`, unbreakable: true, stack: [
      text(String(index + 1).padStart(2, '0'), { fontSize: 11, bold: true, color: accent, margin: [0, 16, 0, 12] }),
      { ...text(heading, { fontSize: 28, bold: true, lineHeight: 1.12, margin: [0, 0, 0, 12] }), tocItem: true, tocStyle: 'tocEntry', id: `health-section-${index}`, headlineLevel: 1 },
      ...(confidence ? [text(confidence, { fontSize: 9, color: muted, margin: [0, 0, 0, 18] })] : []),
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: contentWidth, y2: 0, lineColor: line, lineWidth: 1 }], margin: [0, 0, 0, 22] },
    ] }
    content.push(sectionHeader,
      ...healthMarkdownPdf(section.content, t),
    )
    if (includeNotes && section.thinkingProcess?.trim()) content.push(
      text(t('Analysis notes'), { fontSize: 12, bold: true, color: accent, headlineLevel: 2, margin: [0, 18, 0, 10] }),
      { stack: healthMarkdownPdf(section.thinkingProcess.replace(/^>\s*/gm, ''), t), fontSize: 9, color: muted },
    )
  })
  return {
    pageSize: paper, pageMargins: [48, 64, 48, 58],
    info: { title, author: 'Open Backup UI', subject: t('Point-in-time AI analysis'), creator: 'Open Backup UI', creationDate: exportedAt },
    defaultStyle: { font: 'Report', fontSize: 10.5, lineHeight: 1.3, color: ink },
    styles: { tocEntry: { fontSize: 11, color: ink } },
    background: (page, size) => ({ canvas: page === 1 ? [
      { type: 'rect', x: 0, y: 0, w: size.width, h: 9, color: accent },
      { type: 'rect', x: size.width - 24, y: 9, w: 24, h: size.height - 9, color: '#EAF6F4' },
      { type: 'ellipse', x: size.width - 24, y: 170, r1: 100, r2: 100, lineColor: '#DCEEEB', lineWidth: 0.8 },
      { type: 'ellipse', x: size.width - 24, y: 170, r1: 77, r2: 77, lineColor: '#DCEEEB', lineWidth: 0.8 },
      { type: 'ellipse', x: size.width - 24, y: 170, r1: 54, r2: 54, lineColor: '#DCEEEB', lineWidth: 0.8 },
    ] : [{ type: 'rect', x: 0, y: 0, w: 7, h: size.height, color: '#EAF6F4' }] }),
    header: page => page === 1 ? [] : { columns: [text('OPEN BACKUP UI', { fontSize: 8, bold: true, color: accent, characterSpacing: 1 }), text(title, { fontSize: 8, color: muted, alignment: 'right' })], margin: [48, 28, 48, 0] },
    footer: (page, pages) => ({ stack: [
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: contentWidth, y2: 0, lineColor: line, lineWidth: 0.6 }], margin: [0, 0, 0, 10] },
      { columns: [text(t('Point-in-time AI analysis'), { fontSize: 8, color: muted }), text(`${new Intl.NumberFormat(locale).format(page)} / ${new Intl.NumberFormat(locale).format(pages)}`, { fontSize: 8, color: accent, alignment: 'right', bold: true })] },
    ], margin: [48, 10, 48, 0] }),
    pageBreakBefore: (node, container) => {
      // A short continuation can share its page with the next section. This
      // avoids dedicating a nearly empty sheet to the last lines of a section.
      if (node.id?.startsWith('health-start-')) return node.startPosition.pageNumber === 1 || node.startPosition.verticalRatio > 0.22
      return !!node.headlineLevel && container.getFollowingNodesOnPage().length === 0
    },
    content,
  }
}
