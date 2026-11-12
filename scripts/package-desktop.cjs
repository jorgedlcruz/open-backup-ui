// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
// Package an already prepared Git bundle for offline GitHub Desktop import.
// This builder never mutates Git repositories or copies local runtime state.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { buildZip, verifyZip } = require('./package-source.cjs')

const ROOT = path.resolve(__dirname, '..')
const PART_BYTES = 8 * 1024 * 1024
const PAGE_LIMIT = 10 * 1024 * 1024
const REMOTE = 'https://github.com/jorgedlcruz/open-backup-ui.git'
const BRANCH = 'features/v1.0.0'
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const crlf = text => text.replace(/\r?\n/g, '\r\n')

function count(value, label) {
  const result = Array.isArray(value) ? value.length : value
  if (!Number.isInteger(result) || result < 1) throw new Error(`Metadata needs a positive ${label} count.`)
  return result
}

function validateMetadata(input) {
  if (!input || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(input.version)) throw new Error('Metadata needs a valid version.')
  if (input.branch !== BRANCH) throw new Error(`Expected branch ${BRANCH}.`)
  if (input.remote !== REMOTE) throw new Error(`Expected remote ${REMOTE}.`)
  for (const field of ['commit', 'baseCommit']) if (!/^[a-f\d]{40}(?:[a-f\d]{24})?$/i.test(input[field] || '')) throw new Error(`Metadata needs a valid ${field}.`)
  return {
    version: input.version,
    branch: input.branch,
    commit: input.commit.toLowerCase(),
    baseCommit: input.baseCommit.toLowerCase(),
    remote: input.remote,
    sourceFiles: count(input.sourceFiles, 'source file'),
    images: count(input.images, 'image'),
  }
}

function preparePowerShell() {
  return crlf(String.raw`# Windows PowerShell 5.1. Restore only the bundled, SHA-256-verified snapshot.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$scriptRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$rootPrefix = $scriptRoot.TrimEnd([char[]]'\/') + [System.IO.Path]::DirectorySeparatorChar

function Get-SafeChildPath {
    param([Parameter(Mandatory = $true)][string]$Name)
    if ([string]::IsNullOrWhiteSpace($Name) -or $Name -eq '.' -or $Name -eq '..' -or
        $Name.IndexOfAny([char[]]'/\:') -ge 0 -or [System.IO.Path]::GetFileName($Name) -ne $Name) {
        throw "Unsafe package filename: $Name"
    }
    $candidate = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($scriptRoot, $Name))
    if (-not $candidate.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'A package path left its extraction folder.'
    }
    return $candidate
}

function Assert-File {
    param([string]$File, [long]$Bytes, [string]$Hash)
    $item = Get-Item -LiteralPath $File -ErrorAction Stop
    if ($item.PSIsContainer -or $item.Length -ne $Bytes) { throw "Unexpected size: $File" }
    if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Hash.ToLowerInvariant()) {
        throw "SHA-256 mismatch: $File. Download this package part again."
    }
}

function Get-ArchiveCandidates {
    param([string]$ArchiveFile)
    if ($ArchiveFile -notmatch '^[a-zA-Z0-9._-]+\.zip$') { throw 'Invalid archive filename in manifest.' }
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($ArchiveFile)
    $seen = @{}
    $directory = $scriptRoot
    for ($level = 0; $level -lt 3 -and $directory; $level++) {
        # Pages can append a file identifier before .zip. Match only this part's prefix.
        foreach ($file in @(Get-ChildItem -LiteralPath $directory -Filter ($stem + '*.zip') -File -ErrorAction SilentlyContinue)) {
            if (-not $seen.ContainsKey($file.FullName)) { $seen[$file.FullName] = $true; Write-Output $file.FullName }
        }
        $parent = [System.IO.Directory]::GetParent($directory)
        if ($null -eq $parent) { break }
        $directory = $parent.FullName
    }
}

function Get-VerifiedPart {
    param($Part)
    $destination = Get-SafeChildPath ([string]$Part.file)
    if (Test-Path -LiteralPath $destination) {
        Assert-File $destination ([long]$Part.bytes) ([string]$Part.sha256)
        return $destination
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $problems = @()
    foreach ($archiveFile in @(Get-ArchiveCandidates ([string]$Part.archiveFile))) {
        $archive = $null
        $temporary = $null
        try {
            $archive = [System.IO.Compression.ZipFile]::OpenRead($archiveFile)
            $entries = @($archive.Entries | Where-Object { $_.FullName -ceq [string]$Part.file })
            if ($entries.Count -eq 0) { continue }
            if ($entries.Count -ne 1 -or $entries[0].Length -ne [long]$Part.bytes) { throw 'Unexpected or duplicate chunk entry.' }
            $temporary = Get-SafeChildPath (([string]$Part.file) + '.preparing-' + [guid]::NewGuid().ToString('N'))
            $source = $null
            $output = $null
            try {
                $source = $entries[0].Open()
                $output = [System.IO.File]::Open($temporary, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
                $buffer = New-Object byte[] 81920
                [long]$written = 0
                while ($true) {
                    $requested = [int][Math]::Min($buffer.Length, ([long]$Part.bytes - $written + 1))
                    $read = $source.Read($buffer, 0, $requested)
                    if ($read -eq 0) { break }
                    $written += $read
                    if ($written -gt [long]$Part.bytes) { throw 'The ZIP chunk exceeds its expected size.' }
                    $output.Write($buffer, 0, $read)
                }
                if ($written -ne [long]$Part.bytes) { throw 'The ZIP chunk is incomplete.' }
            } finally {
                if ($null -ne $output) { $output.Dispose() }
                if ($null -ne $source) { $source.Dispose() }
            }
            Assert-File $temporary ([long]$Part.bytes) ([string]$Part.sha256)
            [System.IO.File]::Move($temporary, $destination)
            $temporary = $null
            return $destination
        } catch {
            $problems += ([System.IO.Path]::GetFileName($archiveFile) + ': ' + $_.Exception.Message)
        } finally {
            if ($null -ne $archive) { $archive.Dispose() }
            # Only a newly created, scoped temporary file is removed on failure.
            if ($temporary -and (Test-Path -LiteralPath $temporary)) { Remove-Item -LiteralPath $temporary -Force }
        }
    }
    $detail = if ($problems.Count) { ' ' + ($problems -join ' ') } else { '' }
    throw ('Missing package part: ' + [string]$Part.file + '. Put every numbered ZIP beside Part 1, or extract all parts into this folder.' + $detail)
}

function Find-Git {
    $command = Get-Command git.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $command) { return $command.Source }
    if ($env:LOCALAPPDATA) {
        $desktop = Join-Path $env:LOCALAPPDATA 'GitHubDesktop'
        if (Test-Path -LiteralPath $desktop) {
            foreach ($app in @(Get-ChildItem -LiteralPath $desktop -Directory -Filter 'app-*' | Sort-Object LastWriteTime -Descending)) {
                $candidate = Join-Path $app.FullName 'resources\app\git\cmd\git.exe'
                if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
            }
        }
    }
    if ($env:ProgramFiles) {
        $candidate = Join-Path $env:ProgramFiles 'Git\cmd\git.exe'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    throw 'Git was not found. Install GitHub Desktop or Git for Windows, then run this launcher again.'
}

function Invoke-Git {
    param([string[]]$Arguments)
    $previousPreference = $ErrorActionPreference
    try {
        # Native Git writes progress to stderr; inspect its exit code explicitly.
        $ErrorActionPreference = 'Continue'
        $result = & $script:gitPath -c core.longpaths=true @Arguments
        $exitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    if ($exitCode -ne 0) { throw ('Git failed: ' + ($Arguments -join ' ')) }
    return $result
}

try {
    $manifest = Get-Content -LiteralPath (Get-SafeChildPath 'bundle-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1 -or $manifest.branch -ne 'features/v1.0.0' -or
        $manifest.remote -ne 'https://github.com/jorgedlcruz/open-backup-ui.git' -or
        $manifest.targetDirectory -ne 'open-backup-ui') { throw 'This is not the expected Open Backup UI Desktop package.' }
    foreach ($hash in @($manifest.commit, $manifest.baseCommit, $manifest.bundle.sha256)) {
        if ([string]$hash -notmatch '^[a-fA-F0-9]{40}([a-fA-F0-9]{24})?$') { throw 'Invalid manifest digest.' }
    }
    $parts = @($manifest.parts)
    if (-not $parts.Count -or [long]$manifest.bundle.bytes -lt 1) { throw 'The package manifest has no bundle data.' }
    [long]$totalBytes = 0
    for ($i = 0; $i -lt $parts.Count; $i++) {
        if ([int]$parts[$i].number -ne $i + 1 -or [long]$parts[$i].bytes -lt 1 -or [long]$parts[$i].bytes -gt 8388608 -or
            [string]$parts[$i].sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid numbered part in manifest.' }
        $null = Get-SafeChildPath ([string]$parts[$i].file)
        $totalBytes += [long]$parts[$i].bytes
    }
    if ($totalBytes -ne [long]$manifest.bundle.bytes) { throw 'The numbered parts do not match the bundle size.' }
    $destination = Get-SafeChildPath ([string]$manifest.targetDirectory)
    if (Test-Path -LiteralPath $destination) { throw ('Refusing to overwrite an existing folder: ' + $destination) }
    $bundle = Get-SafeChildPath ([string]$manifest.bundle.file)
    if (Test-Path -LiteralPath $bundle) {
        Assert-File $bundle ([long]$manifest.bundle.bytes) ([string]$manifest.bundle.sha256)
    } else {
        Write-Host 'Checking and joining the downloaded package parts...'
        $partFiles = @($parts | ForEach-Object { Get-VerifiedPart $_ })
        $temporaryBundle = Get-SafeChildPath (([string]$manifest.bundle.file) + '.preparing-' + [guid]::NewGuid().ToString('N'))
        $output = $null
        try {
            $output = [System.IO.File]::Open($temporaryBundle, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
            foreach ($partFile in $partFiles) {
                $source = [System.IO.File]::OpenRead($partFile)
                try { $source.CopyTo($output) } finally { $source.Dispose() }
            }
            $output.Dispose()
            $output = $null
            Assert-File $temporaryBundle ([long]$manifest.bundle.bytes) ([string]$manifest.bundle.sha256)
            [System.IO.File]::Move($temporaryBundle, $bundle)
            $temporaryBundle = $null
        } finally {
            if ($null -ne $output) { $output.Dispose() }
            if ($temporaryBundle -and (Test-Path -LiteralPath $temporaryBundle)) { Remove-Item -LiteralPath $temporaryBundle -Force }
        }
    }
    $script:gitPath = Find-Git
    $head = [string](@(Invoke-Git -Arguments @('bundle', 'list-heads', $bundle, ('refs/heads/' + $manifest.branch))) -join "\n")
    $expectedHead = ([string]$manifest.commit) + ' refs/heads/' + ([string]$manifest.branch)
    if ($head.Trim() -cne $expectedHead) { throw 'The verified bundle does not expose the expected branch and commit.' }
    Write-Host 'Restoring the prepared Git branch offline...'
    Invoke-Git -Arguments @('clone', '--config', 'core.longpaths=true', '--branch', [string]$manifest.branch, '--', $bundle, $destination)
    Invoke-Git -Arguments @('-C', $destination, 'remote', 'remove', 'origin')
    Invoke-Git -Arguments @('-C', $destination, 'remote', 'add', 'origin', [string]$manifest.remote)
    $main = [string](@(Invoke-Git -Arguments @('-C', $destination, 'branch', '--list', 'main')) -join "\n")
    if (-not $main.Trim()) { Invoke-Git -Arguments @('-C', $destination, 'branch', 'main', [string]$manifest.baseCommit) }
    $actualCommit = [string](@(Invoke-Git -Arguments @('-C', $destination, 'rev-parse', 'HEAD')) -join "\n")
    $actualBranch = [string](@(Invoke-Git -Arguments @('-C', $destination, 'branch', '--show-current')) -join "\n")
    $actualRemote = [string](@(Invoke-Git -Arguments @('-C', $destination, 'remote', 'get-url', 'origin')) -join "\n")
    $status = [string](@(Invoke-Git -Arguments @('-C', $destination, 'status', '--porcelain')) -join "\n")
    $tracking = [string](@(Invoke-Git -Arguments @('-C', $destination, 'for-each-ref', '--format=%(refname)', 'refs/remotes/origin/')) -join "\n")
    if ($actualCommit.Trim() -cne [string]$manifest.commit -or $actualBranch.Trim() -cne [string]$manifest.branch -or
        $actualRemote.Trim() -cne [string]$manifest.remote -or $status.Trim() -or $tracking.Trim()) { throw 'The restored repository did not pass its branch, remote, and clean-checkout checks.' }
    Invoke-Git -Arguments @('-C', $destination, 'fsck', '--full')
    Write-Host ''
    Write-Host ('Ready: ' + $destination)
    Write-Host ('Branch: ' + $manifest.branch)
    Write-Host ('Commit: ' + $manifest.commit)
    Write-Host ''
    Write-Host 'In GitHub Desktop choose File > Add local repository and select the open-backup-ui folder.'
    Write-Host 'Fetch and review remote changes, then publish or push features/v1.0.0 when ready.'
    Write-Host 'Use PR.md for the pull request into main and RELEASE.md for the v1.0.0 release.'
    Write-Host 'No fetch, push, tag, sign-in, dependency installation, or global Git configuration was performed.'
} catch {
    Write-Host ''
    Write-Host ('Preparation stopped: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
`)
}

function prepareCommand() {
  return crlf('@echo off\nsetlocal\npowershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Prepare-Repository.ps1"\nset "prepareResult=%ERRORLEVEL%"\necho.\nif not "%prepareResult%"=="0" echo Read the message above before trying again.\npause\nexit /b %prepareResult%\n')
}

function startHere(metadata, partCount, distribution) {
  return crlf(`OPEN BACKUP UI v${metadata.version} - GITHUB DESKTOP IMPORT\n\nPrepared branch: ${metadata.branch}\nCommit: ${metadata.commit}\nGitHub repository: ${metadata.remote}\nSource files: ${metadata.sourceFiles}; image assets: ${metadata.images}.\n\nDOWNLOAD\nExtract ${distribution}.zip into a new folder. For numbered alternatives, download all ${partCount} part ZIPs into the same folder, extract Part 1, and keep the other ZIPs beside the extracted folder.\n\nPREPARE AND OPEN\nDouble-click "Prepare repository.cmd". It verifies SHA-256 hashes and restores a new open-backup-ui folder offline. It refuses to overwrite an existing checkout and supports long Windows Git paths.\n\nIn GitHub Desktop choose File > Add local repository and select the restored open-backup-ui folder. The branch is ${metadata.branch}. Fetch and review the GitHub state, then publish the branch and open a PR into main.\n\nDOCUMENTS\nPR.md: use the first heading as the PR title and the remaining Markdown as the description.\nRELEASE.md: ready-to-paste release body for tag v${metadata.version}.\nREADME.md: updated project README, also included in the checkout.\nPR image URLs resolve after the branch is pushed; release image URLs resolve after the matching tag is published.\n\nRUN THE APPLICATION\nUse Node.js 22. Inside the restored folder run:\n  npm ci\n  npm run dev\nOpen http://localhost:3000/connect and configure the server connections.\n\nCONTENTS\nApplication code, localization, capacity-planning cache, themes, documentation, 43 release screenshots, nine Connect images, and the remaining application image assets. Saved connections, runtime data, local environment files, dependencies, builds, and conversation attachments are excluded from the prepared snapshot. The launcher does not fetch, push, create tags, sign in, or change global Git configuration.\n`)
}
function writeVerifiedZip(file, entries) {
  const archive = buildZip(entries)
  verifyZip(archive, entries)
  fs.writeFileSync(file, archive)
  verifyZip(fs.readFileSync(file), entries)
  return { path: file, file: path.basename(file), bytes: archive.length, sha256: sha256(archive) }
}

function buildDesktopPackage(options = {}) {
  const root = options.root || ROOT
  const bundleFile = path.resolve(options.bundle || path.join(root, 'artifacts/open-backup-ui-v1.0.0.bundle'))
  const metadataFile = path.resolve(options.metadata || path.join(root, 'tmp/desktop-preparation/snapshot.json'))
  const out = path.resolve(options.out || path.join(root, 'artifacts/desktop'))
  const metadata = validateMetadata(JSON.parse(fs.readFileSync(metadataFile, 'utf8')))
  const bundle = fs.readFileSync(bundleFile)
  if (!bundle.length || !bundle.subarray(0, 32).toString('ascii').startsWith('# v')) throw new Error('Expected a nonempty Git bundle.')
  const prefix = `open-backup-ui-v${metadata.version}`
  const distribution = `${prefix}-github-desktop-clean`
  const bundleName = `${prefix}.bundle`
  const partCount = Math.ceil(bundle.length / PART_BYTES)
  const digits = Math.max(2, String(partCount).length)
  const number = value => String(value).padStart(digits, '0')
  const chunks = Array.from({ length: partCount }, (_, index) => {
    const content = bundle.subarray(index * PART_BYTES, Math.min(bundle.length, (index + 1) * PART_BYTES))
    return { number: index + 1, file: `${bundleName}.part${number(index + 1)}`, bytes: content.length, sha256: sha256(content), archiveFile: `${distribution}-part-${number(index + 1)}-of-${number(partCount)}.zip`, content }
  })
  const manifest = { schemaVersion: 1, ...metadata, targetDirectory: 'open-backup-ui', bundle: { file: bundleName, bytes: bundle.length, sha256: sha256(bundle) }, parts: chunks.map(({ content, ...part }) => part) }
  const documents = [
    ['PR.md', path.join(root, 'docs/releases/v1.0.0-pull-request.md')],
    ['RELEASE.md', path.join(root, 'artifacts/github-release.md')],
    ['README.md', path.join(root, 'README.md')],
  ].map(([name, source]) => ({ name, content: fs.readFileSync(source) }))
  const wrappers = [
    { name: 'Prepare-Repository.ps1', content: Buffer.from(preparePowerShell(), 'utf8') },
    { name: 'Prepare repository.cmd', content: Buffer.from(prepareCommand(), 'utf8') },
    { name: 'START-HERE.txt', content: Buffer.from(startHere(metadata, partCount, distribution), 'utf8') },
    { name: 'bundle-manifest.json', content: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') },
    ...documents,
  ]
  fs.mkdirSync(out, { recursive: true })
  // Expose the launchers for review as well as including them in the archives.
  for (const entry of wrappers) fs.writeFileSync(path.join(out, entry.name), entry.content)
  const full = writeVerifiedZip(path.join(out, `${distribution}.zip`), [...wrappers, { name: bundleName, content: bundle }])
  const parts = chunks.map((chunk, index) => {
    const entries = index === 0 ? [...wrappers, { name: chunk.file, content: chunk.content }] : [{ name: chunk.file, content: chunk.content }]
    const result = writeVerifiedZip(path.join(out, chunk.archiveFile), entries)
    if (result.bytes > PAGE_LIMIT) throw new Error(`Page part is over 10 MiB: ${result.file}`)
    return result
  })
  const summary = { ...metadata, bundle: manifest.bundle, full, parts, manifest: path.join(out, 'bundle-manifest.json') }
  fs.writeFileSync(path.join(out, 'package-summary.json'), JSON.stringify(summary, null, 2) + '\n')
  fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), [full, ...parts].map(file => `${file.sha256}  ${file.file}`).join('\n') + '\n')
  return summary
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2)
    const allowed = new Set(['--bundle', '--metadata', '--out'])
    const options = {}
    for (let index = 0; index < args.length; index += 2) {
      if (!allowed.has(args[index]) || !args[index + 1]) throw new Error('Usage: node scripts/package-desktop.cjs [--bundle file] [--metadata file] [--out directory]')
      options[args[index].slice(2)] = args[index + 1]
    }
    console.log(JSON.stringify(buildDesktopPackage(options), null, 2))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}

module.exports = { buildDesktopPackage, validateMetadata, preparePowerShell, prepareCommand, startHere, PART_BYTES, PAGE_LIMIT }
