// Open Backup UI v1.3.0
/* eslint-disable @typescript-eslint/no-require-imports */
const {parentPort,workerData}=require('node:worker_threads')
const MsgReader=require('@kenjiuno/msgreader').default

// Parse only on demand in a bounded worker. Never resolve attachments or external links.
const message=new MsgReader(workerData).getFileData()
const limit=2*1024*1024

function decodeHtml(bytes, codepage) {
  if (!bytes?.length) return ''
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder().decode(bytes)

  const prefix = Buffer.from(bytes.subarray(0, 1024)).toString('latin1')
  const charset = /<meta\b[^>]*?\bcharset\s*=\s*["']?\s*([\w.-]+)/i.exec(prefix)?.[1]
  const codepages = {932:'shift_jis',936:'gbk',949:'euc-kr',950:'big5',1200:'utf-16le',1201:'utf-16be',65001:'utf-8'}
  for (const label of [charset, codepages[codepage] || (codepage && 'windows-' + codepage)]) {
    if (!label) continue
    try { return new TextDecoder(label).decode(bytes) }
    catch { /* Try the next encoding if the label is unsupported. */ }
  }
  return new TextDecoder().decode(bytes)
}

const html = message.bodyHtml?.trim() || decodeHtml(message.html, message.internetCodepage || message.messageCodepage).replace(/\0+$/, '').trim()
const content = html || message.body || ''
parentPort.postMessage({
  format: html ? 'html' : content ? 'text' : 'unavailable',
  content: content.slice(0, limit),
  truncated: content.length > limit,
})
