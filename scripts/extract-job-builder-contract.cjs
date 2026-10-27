// Regenerate with: node scripts/extract-job-builder-contract.cjs path/to/swagger.json
// Keep the native validation keywords; omit descriptions/examples and unrelated
// polymorphic job branches. The tests select each concrete job/inventory type.
const fs=require('node:fs'),crypto=require('node:crypto');
const raw=fs.readFileSync(process.argv[2],'utf8'),spec=JSON.parse(raw),schemas={};
const keys=new Set(['type','format','enum','required','properties','items','allOf','minimum','maximum','minLength','maxLength','minItems','maxItems','uniqueItems','nullable','pattern']);
function clean(value) {
  if(Array.isArray(value))return value.map(clean);
  if(!value||typeof value!=='object')return value;
  const result={};
  for(const [key,item] of Object.entries(value)) {
    if(key==='$ref'){result[key]=item;add(item.split('/').pop());}
    else if(key==='properties')result.properties=Object.fromEntries(Object.entries(item).map(([name,child])=>[name,clean(child)]));
    else if(keys.has(key))result[key]=clean(item);
  }
  return result;
}
function add(name) {if(schemas[name])return;schemas[name]={};const source=spec.components.schemas[name];if(!source)throw new Error('Missing schema: '+name);schemas[name]=clean(source);}
for(const name of ['BackupJobSpec','HyperVBackupJobSpec','VmwareObjectModel','HyperVObjectModel'])add(name);
fs.mkdirSync('tests/fixtures',{recursive:true});
fs.writeFileSync('tests/fixtures/job-builder-contract.json',JSON.stringify({source:'User-supplied VBR OpenAPI specification',version:spec.info.version,sha256:crypto.createHash('sha256').update(raw).digest('hex'),schemas},null,2)+'\n');
console.log('Extracted '+Object.keys(schemas).length+' native schemas.');
