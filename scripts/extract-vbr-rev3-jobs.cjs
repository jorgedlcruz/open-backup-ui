// Open Backup UI v1.3.0
// Run from the repo root: node scripts/extract-vbr-rev3-jobs.cjs <VBR OpenAPI JSON>
const fs = require('node:fs')
const crypto = require('node:crypto')
const specText = fs.readFileSync(process.argv[2], 'utf8')
const document = JSON.parse(specText.replace(/^\uFEFF/, ''))
if (document.info.version !== '1.3-rev3') throw new Error('Expected VBR 1.3-rev3.')
const schemas = document.components.schemas
const types = ['RedHatOpenStackBackupJob', 'VirtuozzoBackupJob', 'UnixAgentBackup', 'UnixAgentBackupServerPolicy',
  'MacAgentBackupServerPolicy', 'MacAgentBackupWorkstationPolicy', 'VSphereCdpPolicy', 'WindowsUniversalCdpPolicy',
  'LinuxUniversalCdpPolicy', 'StorageCopy']
const definitions = Object.create(null)
const nameOf = ref => ref.split('/').pop()
const refTo = name => ({ $ref: '#/$defs/' + name })
const keywords = ['type','format','enum','pattern','minimum','maximum','minLength','maxLength','minItems','maxItems','uniqueItems']
function flatten(source) {
  const result = {...source}
  delete result.allOf
  for (const part of source.allOf || []) {
    // Inheriting a base imports its fields. Its discriminator applies only when the base itself is requested.
    const parent = flatten(part.$ref ? schemas[nameOf(part.$ref)] : part)
    Object.assign(result, {type: parent.type || result.type,
      required: [...new Set([...(result.required || []), ...(parent.required || [])])],
      properties:{...result.properties, ...parent.properties}})
  }
  return result
}
function concrete(schema, tag) {
  const value = flatten(schema)
  const output = Object.fromEntries(keywords.filter(k=>k in value).map(k=>[k,value[k]]))
  // OpenAPI integer/float wire formats are not JSON Schema string formats.
  if (output.type !== 'string' || !['uuid','date-time','date','ipv4','ipv6','email','uri'].includes(output.format)) delete output.format
  if (value.properties || value.type === 'object') {
    output.properties = Object.fromEntries(Object.entries(value.properties || {}).map(([k,v])=>[k,convert(v)]))
    if (tag) output.properties[tag.property] = {const:tag.value,type:'string'}
    const required = [...new Set([...(value.required || []), ...(tag ? [tag.property] : [])])]
    if (required.length) output.required = required
    output.additionalProperties = value.additionalProperties ? (value.additionalProperties === true || convert(value.additionalProperties)) : false
  }
  if (value.items) output.items = convert(value.items)
  if (value.nullable) return {anyOf:[output,{type:'null'}]}
  return output
}
function convert(schema) {
  if (!schema.$ref) return concrete(schema)
  const name = nameOf(schema.$ref)
  add(name)
  return refTo(name)
}
function add(name, tag, alias=name) {
  if (Object.hasOwn(definitions,alias)) return
  definitions[alias] = {}
  const schema = schemas[name]
  if (!schema) throw new Error('Unknown definition '+name)
  const discriminator = schema.discriminator
  if (discriminator && !tag) {
    const variants = Object.entries(discriminator.mapping)
    definitions[alias] = {oneOf:variants.map(([value,ref])=>{
      const child = nameOf(ref), variant=alias+'_'+value
      add(child,{property:discriminator.propertyName,value},variant)
      return refTo(variant)
    })}
  } else definitions[alias] = concrete(schema,tag)
}
const jobs = Object.fromEntries(types.map(type=>{
  const modes={}
  for (const [mode,base] of [['create','JobSpec'],['edit','JobModel']]) {
    const schemaName=nameOf(schemas[base].discriminator.mapping[type]), alias=type+'_'+mode
    add(schemaName,{property:'type',value:type},alias)
    modes[mode]=alias
  }
  return [type,modes]
}))
const result={apiRevision:document.info.version,sha256:crypto.createHash('sha256').update(specText).digest('hex'),jobs,definitions}
const output=JSON.stringify(result,null,2)+'\n'
fs.writeFileSync('lib/job-builder/rev3-contract.json',output)
const examples = Object.fromEntries(types.map(type=>{
  const name=nameOf(schemas.JobSpec.discriminator.mapping[type])
  const example=Object.entries(document.components.examples).find(([key,entry])=>key.startsWith(name)&&entry.value?.type===type&&!entry.value.id)
  if(!example)throw new Error('Missing create-job example for '+type)
  return [type,example[1].value]
}))
fs.writeFileSync('tests/fixtures/rev3-jobs.json',JSON.stringify(examples,null,2)+'\n')
