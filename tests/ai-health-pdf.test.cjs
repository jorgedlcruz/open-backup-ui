/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
const { test } = require('node:test'), assert = require('node:assert/strict')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename)
const { createHealthPdf, healthMarkdownPdf, healthPdfFonts, safeReportLink } = require('../lib/ai-integrations/health-pdf.ts')
const { readHealthSections } = require('../lib/ai-integrations/health-sections.ts')
const { translate } = require('../lib/i18n/model.ts')
const en = require('../lib/i18n/messages/en.json')
const t = (key, values) => translate(en, key, values)
const completion = fs.readFileSync(path.join(__dirname, 'fixtures/ai-health-summary.md'), 'utf8')
const options = { completion, locale: 'en', t, generatedAt: new Date('2026-11-01T09:15:00Z'), exportedAt: new Date('2026-11-01T10:00:00Z'), paper: 'A4', includeNotes: false }
function textOf(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textOf).join('')
  if (value && typeof value === 'object' && 'text' in value) return textOf(value.text)
  if (value && typeof value === 'object') return Object.entries(value).filter(([key]) => !['info', 'styles'].includes(key)).map(([, item]) => textOf(item)).join('')
  return ''
}

test('exports every section and exact evidence while keeping optional analysis notes separate', () => {
  const document = createHealthPdf(options), content = textOf(document.content)
  for (const text of ['Overview', 'Operations Health', 'Security Posture', 'Audit Events', 'London - primary', '82.4 TB', 'Rejected']) assert.ok(content.includes(text), text)
  assert.ok(!content.includes('Compare the latest session results'))
  assert.ok(textOf(createHealthPdf({ ...options, includeNotes: true }).content).includes('Compare the latest session results'))
  assert.throws(() => createHealthPdf({ ...options, completion: '   ' }), /completed summary/)
})

test('PDF and tabs share merged section parsing without duplicating or leaking reasoning', () => {
  const sections = readHealthSections('Preface.\n### Overview\nA\n<thinking>Notes</thinking>\n### Overview | Confidence: 90%\nB\n### Audit Events\nC', 'Overview')
  assert.equal(sections.length, 2)
  assert.equal(sections[0].thinkingProcess, 'Notes')
  assert.match(sections[0].content, /Preface\.[\s\S]*A[\s\S]*B/)
  assert.ok(!sections[0].content.includes('Notes'))
})

test('Markdown retains formatting and table values without loading remote content or unsafe links', () => {
  const content = healthMarkdownPdf('**Bold** and *italic* with `repo-01`.\n\n| Host | State |\n| --- | --- |\n| repo-01 | Ready |\n\n![Diagram](https://untrusted.test/image)\n\n<script>bad()</script>\n\n[Safe](https://example.com/docs) [Unsafe](javascript:alert)\n\nRecommendation: Review the repository.', t)
  const json = JSON.stringify(content)
  assert.ok(json.includes('repo-01') && json.includes('Ready'))
  assert.ok(json.includes('"bold":true') && json.includes('"italics":true'))
  assert.ok(json.includes('https://example.com/docs'))
  assert.ok(!json.includes('https://untrusted.test') && !json.includes('javascript:') && !json.includes('bad()'))
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///secret', '/api/settings']) assert.equal(safeReportLink(url), undefined)
})

test('localized labels preserve multilingual resource names and invalid confidence is omitted', () => {
  const es = require('../lib/i18n/messages/es.json'), translateEs = (key, values) => translate(es, key, values)
  const document = createHealthPdf({ ...options, locale: 'es', t: translateEs, completion: '### Operations Health | Confidence: 999%\nRepositorio 東京-서울-上海 / Москва / मुंबई.\n\nRecommendation: Revisar.' })
  const content = textOf(document.content)
  assert.ok(content.includes('Estado de las operaciones'))
  assert.ok(content.includes('東京-서울-上海 / Москва / मुंबई'))
  assert.ok(content.includes('Recomendación:'))
  assert.ok(!content.includes('999%'))
  const fonts = healthPdfFonts(content)
  assert.ok(fonts.ReportCJK && fonts.ReportHindi)
})

test('real PDF renderer handles long reports, tables and all supported scripts', async () => {
  const pdf = require('pdfmake')
  const fontRoot = path.resolve(__dirname, '../public/fonts/reports')
  const multilingual = '\n\nEnglish · Español · Français · Deutsch · Italiano · Português · Русский · 日本語 · 한국어 · 中文 · हिन्दी'
  const doc = createHealthPdf({ ...options, paper: 'LETTER', completion: completion + multilingual + '\n\n' + ('A long finding about a repository with a very-long-resource-name/'.repeat(20) + '\n\n').repeat(8) })
  const fonts = healthPdfFonts(textOf(doc.content))
  pdf.setLocalAccessPolicy(file => path.resolve(file).startsWith(fontRoot + path.sep))
  pdf.setUrlAccessPolicy(() => false)
  pdf.addFonts(Object.fromEntries(Object.entries(fonts).map(([family, variants]) => [family, Object.fromEntries(Object.entries(variants).map(([variant, file]) => [variant, path.join(fontRoot, file)]))])))
  const buffer = await pdf.createPdf(doc).getBuffer()
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-')
  assert.ok(buffer.length > 15000)
})
