/* eslint-disable @typescript-eslint/no-require-imports */
// Distribute the application source and its assets without copying local state.
// Uses only Node built-ins, so it also works before npm ci.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const zlib = require('node:zlib')

const SOURCE_DIRECTORIES = ['.github', 'app', 'components', 'docs', 'hooks', 'lib', 'public', 'scripts', 'tests']
const ROOT_FILES = [
  '.dockerignore', '.env.example', '.gitattributes', '.gitignore', 'CHANGELOG.md',
  'components.json', 'CONTAINER.md', 'CONTRIBUTING.md', 'DCO.md', 'Dockerfile',
  'eslint.config.mjs', 'instrumentation.ts', 'middleware.ts', 'LICENSE', 'next.config.js',
  'package-lock.json', 'package.json', 'postcss.config.mjs', 'README.md',
  'STANDALONE.md', 'TROUBLESHOOTING.md', 'tsconfig.json',
]
const EXCLUDED_DIRECTORIES = new Set(['node_modules', 'data', 'tmp', 'temp', 'artifacts', 'dist', 'build', 'out', 'coverage', '__pycache__'])
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  return value >>> 0
})

function crc32(buffer) {
  let value = 0xffffffff
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function excluded(name, directory) {
  if (name.startsWith('.')) return true
  if (directory) return EXCLUDED_DIRECTORIES.has(name)
  return /(?:\.(?:zip|tar|gz|7z|log|tmp|bak|pem|key|pfx|p12|tsbuildinfo|swp|swo)|~)$/i.test(name)
}

function collectSourceFiles(root) {
  const files = []
  function visit(relative) {
    const absolute = path.join(root, relative)
    const stat = fs.lstatSync(absolute)
    if (stat.isSymbolicLink()) throw new Error(`Refusing to package a symbolic link: ${relative}`)
    if (stat.isFile()) { files.push(relative.split(path.sep).join('/')); return }
    if (!stat.isDirectory()) throw new Error(`Unsupported source entry: ${relative}`)
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (!excluded(entry.name, entry.isDirectory())) visit(path.join(relative, entry.name))
    }
  }
  for (const file of ROOT_FILES) if (fs.existsSync(path.join(root, file))) visit(file)
  for (const directory of SOURCE_DIRECTORIES) if (fs.existsSync(path.join(root, directory))) visit(directory)
  return files.sort()
}

function buildZip(entries) {
  if (entries.length > 65535) throw new Error('The source archive exceeds the ZIP entry limit.')
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const { name, content } of entries) {
    if (name.startsWith('/') || name.split('/').includes('..') || name.includes('\\')) throw new Error(`Unsafe archive path: ${name}`)
    const filename = Buffer.from(name, 'utf8')
    const deflated = zlib.deflateRawSync(content, { level: 9 })
    const compressed = deflated.length < content.length ? deflated : content
    const method = compressed === content ? 0 : 8
    const crc = crc32(content)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6) // UTF-8 names.
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(33, 12) // 1980-01-01; stable across machines and runs.
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(filename.length, 26)
    localParts.push(local, filename, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x314, 4) // Unix ZIP 2.0, with ordinary file permissions.
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(33, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(content.length, 24)
    central.writeUInt16LE(filename.length, 28)
    central.writeUInt32LE((0o100644 * 65536) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, filename)
    offset += local.length + filename.length + compressed.length
    if (offset > 0xffffffff) throw new Error('The source archive exceeds the ZIP size limit.')
  }
  const directory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, directory, end])
}

function verifyZip(archive, expected) {
  const end = archive.length - 22
  if (end < 0 || archive.readUInt32LE(end) !== 0x06054b50) throw new Error('ZIP directory is missing.')
  if (archive.readUInt16LE(end + 10) !== expected.length) throw new Error('ZIP entry count does not match.')
  let central = archive.readUInt32LE(end + 16)
  for (const entry of expected) {
    if (archive.readUInt32LE(central) !== 0x02014b50) throw new Error('Invalid ZIP directory entry.')
    const nameLength = archive.readUInt16LE(central + 28)
    const name = archive.subarray(central + 46, central + 46 + nameLength).toString('utf8')
    if (name !== entry.name) throw new Error(`ZIP path mismatch: ${name}`)
    const local = archive.readUInt32LE(central + 42)
    if (archive.readUInt32LE(local) !== 0x04034b50) throw new Error(`Invalid ZIP file header: ${name}`)
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28)
    const compressed = archive.subarray(start, start + archive.readUInt32LE(central + 20))
    const content = archive.readUInt16LE(central + 10) === 8 ? zlib.inflateRawSync(compressed) : compressed
    if (!content.equals(entry.content) || crc32(content) !== archive.readUInt32LE(central + 16)) throw new Error(`ZIP integrity check failed: ${name}`)
    central += 46 + nameLength + archive.readUInt16LE(central + 30) + archive.readUInt16LE(central + 32)
  }
  if (central !== end) throw new Error('ZIP directory length does not match.')
}

function packageSource(root, outputDirectory = path.join(root, 'artifacts')) {
  const { name, version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  if (name !== 'open-backup-ui' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Expected an Open Backup UI package and a valid version.')
  const prefix = `${name}-v${version}`
  const files = collectSourceFiles(root)
  for (const required of ['package.json', 'package-lock.json', 'README.md', 'LICENSE']) {
    if (!files.includes(required)) throw new Error(`Required source file is missing: ${required}`)
  }
  const entries = files.map(file => ({ name: `${prefix}/${file}`, content: fs.readFileSync(path.join(root, file)) }))
  const archive = buildZip(entries)
  verifyZip(archive, entries)
  fs.mkdirSync(outputDirectory, { recursive: true })
  const destination = path.join(outputDirectory, `${prefix}.zip`)
  fs.writeFileSync(destination, archive)
  const saved = fs.readFileSync(destination)
  verifyZip(saved, entries)
  const sha256 = crypto.createHash('sha256').update(saved).digest('hex')
  fs.writeFileSync(`${destination}.sha256`, `${sha256}  ${path.basename(destination)}\n`)
  return {
    path: destination, files: entries.length, images: files.filter(file => /\.(webp|png|jpg|jpeg|svg|gif|ico)$/i.test(file)).length,
    sourceBytes: entries.reduce((sum, entry) => sum + entry.content.length, 0), zipBytes: archive.length, sha256,
  }
}

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..')
    const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'artifacts')
    console.log(JSON.stringify(packageSource(root, output), null, 2))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}

module.exports = { collectSourceFiles, buildZip, verifyZip, packageSource }
