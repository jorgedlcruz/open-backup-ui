// Open Backup UI v1.0.2
/* eslint-disable @typescript-eslint/no-require-imports */
// Read-only source audit. This deliberately never imports application code or reads
// data/, environment files, API responses, or browser/server state.
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const UI_PROPS = new Set(['title', 'subtitle', 'label', 'placeholder', 'aria-label', 'alt', 'description', 'detail', 'message', 'emptyText', 'heading', 'caption', 'tooltip', 'helperText', 'emptyMessage', 'loadingText'])
const CONFIG_PROPS = new Set(['title', 'subtitle', 'label', 'description', 'heading', 'caption', 'tooltip', 'helperText', 'emptyMessage', 'ariaLabel'])
// Verified component contracts, qualified by their implementation module. Other
// components named Panel/Pager may render raw props and must remain candidates.
const IMPLICIT_PROPS = {
  'components/investigation/shared': { SearchBox: ['label'], Panel: ['title', 'subtitle'], Pager: ['label'] },
  'components/vbm-dashboard/evidence-panels': { Field: ['label'] },
  'components/vbm-protected/shared': { Fact: ['label'] },
  'components/operations/operations-console': { Panel: ['title', 'subtitle'], Metric: ['title', 'detail'] },
  'components/operations/filter-workspace': { FilterWorkspace: ['label'] },
  'components/operations/filter-facet': { FilterFacet: ['title'], FilterGroup: ['title'], FilterSelect: ['label'] },
  'components/operations/filter-fields': { FilterCondition: ['label'] },
}
const PRODUCTS = new Set(['Open Backup UI', 'Veeam', 'Veeam Backup & Replication', 'Veeam Backup for Microsoft 365', 'Veeam ONE', 'Veeam Recovery Orchestrator', 'Recovery Orchestrator', 'VBR', 'VBM', 'VRO', 'Microsoft 365', 'Microsoft Azure', 'VMware', 'Hyper-V', 'Nutanix AHV', 'Kasten K10', 'Amazon S3', 'Azure', 'AWS', 'OpenAI', 'Anthropic', 'Ollama', 'Google Gemini'])

function readable(value) {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!/[A-Za-z]/.test(text.replace(/\{value\d+\}/g, '')) || PRODUCTS.has(text)) return false
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return false
  if (/^(?:https?:\/\/|[/.#]|[\w.-]+@[\w.-]+\.[a-z]|[\w.-]+\.(?:com|net|org|local|example)(?::\d+)?$)/i.test(text)) return false
  if (/^(?:[A-Z_]+|[a-z]+(?:[-_:][a-z\d]+)+|\d+(?:\.\d+)?\s*(?:KB|MB|GB|TB|KiB|MiB|GiB|TiB|ms|s|%))$/.test(text)) return false
  return true
}

function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) node = node.expression
  return node
}
function propName(node) { return node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) ? node.text : null }
function tagName(node) { return node.tagName.getText().split('.').pop() }
function sourceLocation(node, root) {
  const source = node.getSourceFile()
  const position = source.getLineAndCharacterOfPosition(node.getStart(source))
  return { path: path.relative(root, source.fileName).replace(/\\/g, '/'), line: position.line + 1, column: position.character + 1 }
}

function createAudit(root, files) {
  const sources = new Map()
  const contexts = new Map()
  for (const [filename, text] of files) sources.set(path.resolve(filename), ts.createSourceFile(path.resolve(filename), text, ts.ScriptTarget.Latest, true, filename.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS))
  const registrations = [], candidates = [], dynamic = [], covered = new Set()
  const origin = node => `${node.getSourceFile().fileName}:${node.pos}:${node.end}`
  const literal = (node, value, template = false) => ({ node, value: value.trim(), template })
  function context(source) {
    if (contexts.has(source.fileName)) return contexts.get(source.fileName)
    const ctx = { bindings: new Map(), imports: new Map(), translators: new Set(['t']), trans: new Set(['Trans']) }
    contexts.set(source.fileName, ctx)
    function collect(node) {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        if (ts.isIdentifier(node.name)) ctx.bindings.set(node.name.text, node.initializer)
        else if (ts.isObjectBindingPattern(node.name) && ts.isCallExpression(node.initializer) && node.initializer.expression.getText().endsWith('useI18n')) {
          for (const element of node.name.elements) if (propName(element.propertyName || element.name) === 't' && ts.isIdentifier(element.name)) ctx.translators.add(element.name.text)
        }
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const spec = node.moduleSpecifier.text
        const base = spec.startsWith('@/') ? path.join(root, spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(source.fileName), spec) : null
        const resolved = base && [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')].find(file => sources.has(path.resolve(file)))
        const bindings = node.importClause?.namedBindings
        if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) {
          const imported = (element.propertyName || element.name).text
          if (base) ctx.imports.set(element.name.text, { source: resolved ? sources.get(path.resolve(resolved)) : undefined, filename: resolved || base, name: imported })
          if (imported === 'Trans' && spec.includes('i18n')) ctx.trans.add(element.name.text)
        }
      }
      ts.forEachChild(node, collect)
    }
    collect(source)
    return ctx
  }
  function isTranslatedCall(node) { return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && context(node.getSourceFile()).translators.has(node.expression.text) }
  function implementation(tag, node) {
    const imported = context(node.getSourceFile()).imports.get(tag)
    return { name: imported?.name || tag, module: path.relative(root, imported?.filename || node.getSourceFile().fileName).replace(/\\/g, '/').replace(/\.(?:ts|tsx)$/, '') }
  }
  function member(nodes, key, depth, seen) {
    const result = []
    for (const item of nodes) {
      const node = unwrap(item)
      if (ts.isArrayLiteralExpression(node)) {
        if (key === null) result.push(...node.elements.filter(element => !ts.isSpreadElement(element)))
        else if (/^\d+$/.test(key) && node.elements[Number(key)]) result.push(node.elements[Number(key)])
      }
      if (ts.isObjectLiteralExpression(node)) {
        const properties = node.properties.filter(property => ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property))
        if (key === null) result.push(...properties.map(property => ts.isPropertyAssignment(property) ? property.initializer : property.name))
        else {
          const direct = properties.find(property => propName(property.name) === key)
          if (direct) result.push(ts.isPropertyAssignment(direct) ? direct.initializer : direct.name)
          else for (const spread of node.properties.filter(ts.isSpreadAssignment)) result.push(...member(resolve(spread.expression, depth + 1, seen), key, depth + 1, seen))
        }
      }
    }
    return result
  }
  function mapBinding(node, name, depth, seen) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (!ts.isArrowFunction(parent) && !ts.isFunctionExpression(parent)) continue
      const call = parent.parent
      if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression) || !['map', 'filter', 'find', 'some', 'forEach'].includes(call.expression.name.text)) continue
      const parameter = parent.parameters[0]?.name
      const items = () => member(resolve(call.expression.expression, depth + 1, seen), null, depth + 1, seen)
      if (parameter && ts.isIdentifier(parameter) && parameter.text === name) return items()
      if (parameter && ts.isArrayBindingPattern(parameter)) {
        const index = parameter.elements.findIndex(element => ts.isBindingElement(element) && ts.isIdentifier(element.name) && element.name.text === name)
        if (index >= 0) return member(items(), String(index), depth + 1, seen)
      }
    }
    return null
  }
  function resolve(input, depth = 0, visited = new Set()) {
    const node = unwrap(input)
    if (!node || depth > 16 || visited.has(node)) return []
    const seen = new Set(visited).add(node)
    if (ts.isIdentifier(node)) {
      const mapped = mapBinding(node, node.text, depth, seen)
      if (mapped) return mapped.flatMap(item => resolve(item, depth + 1, seen))
      const ctx = context(node.getSourceFile())
      const binding = ctx.bindings.get(node.text)
      if (binding) return resolve(binding, depth + 1, seen)
      const imported = ctx.imports.get(node.text)
      if (imported?.source) return resolve(context(imported.source).bindings.get(imported.name), depth + 1, seen)
      return []
    }
    if (ts.isConditionalExpression(node)) return [...resolve(node.whenTrue, depth + 1, seen), ...resolve(node.whenFalse, depth + 1, seen)]
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)) return [...resolve(node.left, depth + 1, seen), ...resolve(node.right, depth + 1, seen)]
    if (ts.isPropertyAccessExpression(node)) return member(resolve(node.expression, depth + 1, seen), node.name.text, depth + 1, seen).flatMap(item => resolve(item, depth + 1, seen))
    if (ts.isElementAccessExpression(node)) {
      const argument = unwrap(node.argumentExpression)
      const key = argument && (ts.isStringLiteralLike(argument) || ts.isNumericLiteral(argument)) ? argument.text : null
      return member(resolve(node.expression, depth + 1, seen), key, depth + 1, seen).flatMap(item => resolve(item, depth + 1, seen))
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map') {
      const callback = node.arguments[0]
      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && !ts.isBlock(callback.body)) return resolve(callback.body, depth + 1, seen)
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['filter', 'slice', 'sort', 'toSorted'].includes(node.expression.name.text)) return resolve(node.expression.expression, depth + 1, seen)
    return [node]
  }
  function strings(node) {
    return resolve(node).flatMap(item => {
      if (ts.isStringLiteralLike(item)) return [literal(item, item.text)]
      if (ts.isTemplateExpression(item)) return [literal(item, item.head.text + item.templateSpans.map((span, index) => `{value${index + 1}}${span.literal.text}`).join(''), true)]
      return []
    })
  }
  function register(items, kind, site) {
    for (const item of items) {
      if (!item.value || item.template) continue
      covered.add(origin(item.node))
      registrations.push({ key: item.value, kind, ...sourceLocation(site || item.node, root), source: sourceLocation(item.node, root) })
    }
  }
  function candidate(items, kind, site) {
    for (const item of items) if (readable(item.value)) candidates.push({ text: item.value, kind: item.template ? 'dynamic-template' : kind, ...sourceLocation(site || item.node, root), source: sourceLocation(item.node, root), origin: origin(item.node) })
  }
  function wrapped(node) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isJsxElement(parent)) {
        const tag = tagName(parent.openingElement)
        if (context(parent.getSourceFile()).trans.has(tag) || ['code', 'pre', 'script', 'style', 'FilterCondition'].includes(tag)) return true
      }
    }
    return false
  }
  function payloadConfiguration(node) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isPropertyAssignment(parent) && /^(?:body|payload|request|spec)$/i.test(propName(parent.name) || '')) return true
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) && /(?:payload|requestBody|requestSpec|apiSpec|dto)$/i.test(parent.name.text)) return true
      if (ts.isJsxElement(parent) || ts.isJsxSelfClosingElement(parent) || ts.isArrowFunction(parent) || ts.isFunctionDeclaration(parent)) break
    }
    return false
  }
  function visit(node) {
    if (isTranslatedCall(node)) {
      const values = strings(node.arguments[0])
      register(values, 'call', node)
      if (!values.length) dynamic.push({ kind: 'dynamic-call', expression: node.arguments[0]?.getText().slice(0, 100) || '', ...sourceLocation(node, root) })
    }
    if (ts.isJsxElement(node) && context(node.getSourceFile()).trans.has(tagName(node.openingElement))) {
      for (const child of node.children) {
        if (ts.isJsxText(child)) register([literal(child, child.text.replace(/\s+/g, ' '))], 'trans', node)
        else if (ts.isJsxExpression(child) && child.expression) {
          const values = strings(child.expression)
          register(values, 'trans', node)
          if (!values.length) dynamic.push({ kind: 'dynamic-trans', expression: child.expression.getText().slice(0, 100), ...sourceLocation(node, root) })
        }
      }
    }
    if (ts.isJsxText(node) && !wrapped(node)) candidate([literal(node, node.text.replace(/\s+/g, ' '))], 'jsx-text')
    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent) && !wrapped(node) && !isTranslatedCall(unwrap(node.expression))) candidate(strings(node.expression), 'render-expression', node)
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText()
      const element = node.parent.parent
      const tag = tagName(element)
      const component = implementation(tag, node)
      const expression = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer
      if (UI_PROPS.has(name)) {
        if (IMPLICIT_PROPS[component.module]?.[component.name]?.includes(name)) register(strings(expression), 'implicit-prop', node)
        else if (!wrapped(node) && expression && !isTranslatedCall(unwrap(expression))) candidate(strings(expression), 'ui-prop', node)
      }
      if ((component.module === 'components/operations/grid-view-options' && component.name === 'GridViewOptions' || component.module === 'components/operations/filter-fields' && component.name === 'GridColumnFields') && name === 'columns') {
        const items = member(resolve(expression), null, 0, new Set())
        register(member(items, 'name', 0, new Set()).flatMap(strings), 'implicit-config', node)
      }
      if (component.module === 'components/operations/grid-view-options' && component.name === 'GridViewOptions' && name === 'order') {
        const options = member(resolve(expression), 'options', 0, new Set()).flatMap(item => member(resolve(item), null, 0, new Set()))
        register(member(options, 'label', 0, new Set()).flatMap(strings), 'implicit-config', node)
      }
      if (component.module === 'components/operations/filter-facet' && component.name === 'FilterFacet' && name === 'options') {
        let items = resolve(expression)
        if (items.some(ts.isArrayLiteralExpression)) items = member(items, null, 0, new Set())
        for (const item of items) {
          const translate = member([item], 'translateLabel', 0, new Set()).some(value => unwrap(value).kind === ts.SyntaxKind.TrueKeyword)
          if (translate) register(member([item], 'label', 0, new Set()).flatMap(strings), 'implicit-config', node)
        }
      }
    }
    if (ts.isPropertyAssignment(node) && CONFIG_PROPS.has(propName(node.name)) && ts.isObjectLiteralExpression(node.parent) && !payloadConfiguration(node)) candidate(strings(node.initializer), 'ui-config', node)
    ts.forEachChild(node, visit)
  }
  for (const source of sources.values()) {
    const relative = path.relative(root, source.fileName).replace(/\\/g, '/')
    if (/^(?:app|components)\//.test(relative) || /^lib\/(?:i18n|forecast|topology|ransomware|protected-data|investigation)\/(?:evidence-)?presentation\.ts$/.test(relative) || ['lib/i18n/vbr-errors.ts', 'lib/i18n/m365.ts', 'lib/ai-integrations/health-presentation.ts'].includes(relative)) visit(source)
    const setRegistries = {
      'lib/forecast/presentation.ts': ['planningMessages'],
      'lib/forecast/evidence-presentation.ts': ['evidenceMessages', 'sectionNames'],
    }
    for (const name of setRegistries[relative] || []) {
      const messages = unwrap(context(source).bindings.get(name))
      if (messages && ts.isNewExpression(messages) && messages.arguments?.[0]) {
        const entries = unwrap(messages.arguments[0])
        if (ts.isArrayLiteralExpression(entries)) register(entries.elements.flatMap(strings), 'message-registry')
      }
    }
    if (relative === 'lib/forecast/evidence-presentation.ts') {
      const templates = unwrap(context(source).bindings.get('collectionTemplates'))
      if (templates && ts.isArrayLiteralExpression(templates)) for (const entry of templates.elements) {
        const tuple = unwrap(entry)
        if (ts.isArrayLiteralExpression(tuple) && tuple.elements[1]) register(strings(tuple.elements[1]), 'message-registry')
      }
    }
    // This registry explicitly separates app-authored diagnostics from arbitrary
    // upstream messages. Do not generalize this to all strings in API models.
    if (relative === 'lib/data-sources/presentation.ts') {
      const bindings = context(source).bindings
      const messages = unwrap(bindings.get('sourceMessages'))
      if (messages && ts.isArrayLiteralExpression(messages)) register(messages.elements.flatMap(strings), 'message-registry')
      const templates = unwrap(bindings.get('templates'))
      if (templates && ts.isArrayLiteralExpression(templates)) for (const entry of templates.elements) {
        const tuple = unwrap(entry)
        if (ts.isArrayLiteralExpression(tuple) && tuple.elements[1]) register(strings(tuple.elements[1]), 'message-registry')
      }
    }
  }
  const unique = values => [...new Map(values.map(value => [`${value.path}:${value.line}:${value.column}:${value.key || value.text}:${value.kind}`, value])).values()]
  const findings = unique(candidates.filter(item => item.kind !== 'ui-config' || !covered.has(item.origin)).map(item => { const result = { ...item }; delete result.origin; return result }))
  return { files: [...sources.keys()].filter(file => /^(?:app|components)[/\\]/.test(path.relative(root, file))).length, registrations: unique(registrations), findings, dynamic: unique(dynamic) }
}

function sourceFiles(root, folders = ['app', 'components', 'lib']) {
  const files = []
  function walk(folder) {
    if (!fs.existsSync(folder)) return
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const filename = path.join(folder, entry.name)
      const relative = path.relative(root, filename).replace(/\\/g, '/')
      if (entry.isDirectory()) { if (!['node_modules', '.next', 'data', 'messages', '__tests__', '__fixtures__'].includes(entry.name) && relative !== 'app/api') walk(filename) }
      else if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) files.push([filename, fs.readFileSync(filename, 'utf8')])
    }
  }
  folders.forEach(folder => walk(path.join(root, folder)))
  return files
}
function missingTranslations(registrations, catalogs, kinds = ['call', 'trans', 'message-registry']) {
  const missing = []
  for (const entry of registrations.filter(item => kinds.includes(item.kind))) {
    const locales = Object.entries(catalogs).filter(([, catalog]) => !Object.hasOwn(catalog, entry.key) || typeof catalog[entry.key] !== 'string' || !catalog[entry.key].trim()).map(([locale]) => locale)
    if (locales.length) missing.push({ ...entry, locales })
  }
  return missing
}
function auditProject(root = path.resolve(__dirname, '..')) {
  const result = createAudit(root, sourceFiles(root))
  const catalogFolder = path.join(root, 'lib/i18n/messages')
  const catalogs = Object.fromEntries(fs.readdirSync(catalogFolder).filter(file => file.endsWith('.json')).map(file => [path.basename(file, '.json'), JSON.parse(fs.readFileSync(path.join(catalogFolder, file), 'utf8'))]))
  return { ...result, missing: missingTranslations(result.registrations, catalogs), implicitMissing: missingTranslations(result.registrations, catalogs, ['implicit-prop', 'implicit-config']) }
}
function report(result) {
  console.log(`i18n source audit: ${result.files} app/component files; ${result.registrations.length} registered key uses; ${result.missing.length} explicit uses missing translations.`)
  console.log(`${result.findings.length} possible untranslated UI strings; ${result.implicitMissing.length} implicit key uses missing translations; ${result.dynamic.length} dynamic translation expressions need manual review.`)
  console.log('Candidates are static source findings, not proof that every value should be translated. API data, product identifiers, and code samples must remain intact.')
  const groups = new Map()
  for (const item of result.findings) { const group = item.path.split('/').slice(0, item.path.startsWith('components/') ? 2 : 4).join('/'); if (!groups.has(group)) groups.set(group, []); groups.get(group).push(item) }
  for (const [group, items] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${group}: ${items.length} candidates`)
    for (const item of items.slice(0, 5)) console.log(`  ${item.path}:${item.line} [${item.kind}] ${item.text.slice(0, 150)}`)
  }
  if (result.missing.length) {
    console.log('\nMissing explicit translations:')
    for (const item of result.missing) console.log(`  ${item.path}:${item.line} ${JSON.stringify(item.key)} (${item.locales.join(', ')})`)
  }
  console.log('\nUse --json for every finding and unresolved dynamic expression. --strict fails for missing explicit or verified shared-component keys, not the migration backlog.')
}
if (require.main === module) {
  const result = auditProject()
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2))
  else report(result)
  if (process.argv.includes('--strict') && (result.missing.length || result.implicitMissing.length)) process.exitCode = 1
}
module.exports = { createAudit, auditProject, missingTranslations, readable }
