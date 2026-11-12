// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
// Record the release that contains each tracked project file, including binary assets.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const configFiles = new Set(['Dockerfile', '.dockerignore', '.gitignore', '.gitattributes', '.env.example'])
const manifestPath = 'docs/file-versions.json'

function sourceHeader(file, version) {
  const label = 'Open Backup UI v' + version
  if (/\.(?:[cm]?[jt]s|[jt]sx)$/.test(file)) return '// ' + label
  if (file.endsWith('.css')) return '/* ' + label + ' */'
  if (configFiles.has(file) || /\.ya?ml$/.test(file)) return '# ' + label
  return null
}

function stampSource(text, header) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  // Keep the BOM, interpreter line and format directives in their required position.
  const preamble = /^(?:\uFEFF)?(?:(?:#![^\r\n]*|#\s*syntax=[^\r\n]+|@charset [^\r\n]+;|['"]use (?:client|server|strict)['"];?)[ \t]*\r?\n)*/.exec(text)[0]
  const body = text.slice(preamble.length).replace(/^(?:\/\/ |\/\* |# )Open Backup UI v[\w.+-]+(?: \*\/)?\r?\n/, '')
  return preamble + header + newline + body
}

function updateVersions(root, version, checkOnly) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/.test(version)) throw new Error('Invalid package version')
  const indexed = execFileSync('git', ['-c', 'safe.directory=' + root.replaceAll('\\','/'), 'ls-files', '-z', '--cached'], {cwd:root})
  const files = [...new Set(indexed.toString('utf8').split('\0').filter(Boolean))].sort()
  const stale = []
  let sources = 0
  for (const file of files) {
    const header = sourceHeader(file, version)
    if (!header) continue
    const fullPath = path.join(root, file)
    if (!fs.lstatSync(fullPath).isFile()) continue
    sources++
    const original = fs.readFileSync(fullPath, 'utf8')
    const updated = stampSource(original, header)
    if (original === updated) continue
    if (checkOnly) stale.push(file)
    else fs.writeFileSync(fullPath, updated)
  }
  const manifest = JSON.stringify({version, files:Object.fromEntries(files.map(file => [file, version]))}, null, 2) + '\n'
  const destination = path.join(root, manifestPath)
  const current = fs.existsSync(destination) && fs.readFileSync(destination, 'utf8').replaceAll('\r\n', '\n')
  if (current !== manifest) {
    if (checkOnly) stale.push(manifestPath)
    else fs.writeFileSync(destination, manifest)
  }
  if (stale.length) throw new Error('Run npm run version:files after staging file additions or removals. Out of date: ' + stale.slice(0,5).join(', '))
  return {files:files.length, sources}
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..')
  const {version} = require('../package.json')
  const counts = updateVersions(root, version, process.argv.includes('--check'))
  console.log(`Open Backup UI v${version}: ${counts.sources} source headers, ${counts.files} tracked files.`)
}

module.exports = {sourceHeader, stampSource}
