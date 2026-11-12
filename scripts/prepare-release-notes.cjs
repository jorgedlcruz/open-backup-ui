// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
// Repository Markdown stays portable; GitHub release bodies need absolute URLs.
const fs = require('node:fs')
const path = require('node:path')

function prepareReleaseNotes(root, tag, repository) {
  if (!/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(tag)) throw new Error('Expected a version tag such as v1.0.0.')
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository)) throw new Error('Expected an owner/repository name.')
  const source = path.join(root, 'docs', 'releases', `${tag}.md`)
  const markdown = fs.readFileSync(source, 'utf8')
  return markdown.replace(/(!?)\[([^\]]*)\]\(([^\s)]+)(\s+"[^"]*")?\)/g, (match, image, label, target, title = '') => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) return match
    const [, filename, suffix = ''] = target.match(/^([^?#]*)(.*)$/)
    const absolute = path.resolve(path.dirname(source), decodeURIComponent(filename))
    const relative = path.relative(root, absolute).split(path.sep).join('/')
    if (relative.startsWith('../') || path.isAbsolute(relative)) throw new Error(`Release link leaves the source tree: ${target}`)
    if (!fs.existsSync(absolute)) throw new Error(`Release link does not exist: ${target}`)
    const encoded = relative.split('/').map(encodeURIComponent).join('/')
    const base = image ? `https://raw.githubusercontent.com/${repository}/${tag}/` : `https://github.com/${repository}/blob/${tag}/`
    return `${image}[${label}](${base}${encoded}${suffix}${title})`
  })
}

if (require.main === module) {
  try {
    const [, , tag, repository, destination] = process.argv
    if (!destination) throw new Error('Usage: node scripts/prepare-release-notes.cjs <tag> <owner/repository> <output.md>')
    const output = path.resolve(destination)
    const body = prepareReleaseNotes(path.resolve(__dirname, '..'), tag, repository)
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, body)
    console.log(output)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}

module.exports = { prepareReleaseNotes }
