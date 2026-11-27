// Open Backup UI v1.3.0
import DOMPurify from 'dompurify'

// Mail can supply its own colors, typography and responsive table styles. It
// has no reason to run code, navigate, or contact the sender while previewing.
const policy = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"
const presentationTags = (
  'a abbr address article b bdi bdo big blockquote br caption center cite code col colgroup ' +
  'dd del div dl dt em figcaption figure font footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd ' +
  'li main mark ol p pre q s samp section small span strike strong style sub sup table tbody td th ' +
  'thead tfoot time tr tt u ul wbr'
).split(' ')
const presentationAttributes = (
  'align alt bgcolor border cellpadding cellspacing class color colspan dir face height hidden id ' +
  'lang role rowspan scope size src start style text title type valign width'
).split(' ')
const readerStyle = `
  :root { color-scheme: light; background: white; color: #202124; }
  body { margin: 0; padding: 12px; font: 15px/1.5 system-ui, sans-serif; overflow-wrap: anywhere; }
  *, *::before, *::after { box-sizing: border-box; }
  table, td, th, div, img { min-width: 0 !important; max-width: 100% !important; }
  img { height: auto !important; }
  pre { white-space: pre-wrap; }
  [hidden] { display: none !important; }
`

/** Call in the browser and render only in an iframe with an empty sandbox. */
export function mailPreviewDocument(markup: string): string {
  // Apply the same network policy during parsing and when displaying the result.
  const policyMeta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`
  const root = DOMPurify.sanitize(policyMeta + markup, {
    WHOLE_DOCUMENT: true,
    RETURN_DOM: true,
    ALLOWED_TAGS: presentationTags,
    ALLOWED_ATTR: presentationAttributes,
    ALLOW_DATA_ATTR: false,
  })
  if (!(root instanceof Element) || root.localName !== 'html') throw new Error('Preview unavailable')
  // Dropping an unavailable image's box also drops the space it reserves.
  // Keep its accessible description as ordinary text.
  for (const img of root.querySelectorAll('img')) {
    if (!/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(img.getAttribute('src') ?? '')) {
      img.replaceWith(img.alt.trim())
    }
  }
  const head = root.querySelector('head')
  if (!head) throw new Error('Preview unavailable')
  head.insertAdjacentHTML('afterbegin', policyMeta + '<style>' + readerStyle + '</style>')
  return '<!doctype html>' + root.outerHTML
}
