// Open Backup UI v1.0.2
import {spawn} from 'node:child_process'
import path from 'node:path'
import {z} from 'zod'
import {VbrRecoveryError} from '../recovery/error'

// Only textual attributes with compatible VEAD and LDAP representations are compared.
// Operational secrets, security descriptors, and binary/constructed attributes are excluded.
const textual=new Set(['name','cn','displayname','description','distinguishedname','samaccountname','userprincipalname','department',
  'company','title','mail','telephonenumber','streetaddress','postalcode','l','st','c','physicaldeliveryofficename','givenname','sn',
  'manager','memberof','member','grouptype','useraccountcontrol','dnshostname','operatingsystem','operatingsystemversion','ou'])
type Attribute={name:string;values?:string[]|null}
export type DirectorySnapshot={guid:string;domain:string;dn:string;attributes:Record<string,string[]>}
const names=/^DC=([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)$/i
function domainFromDn(dn:string){
  // Only the trailing naming context is authoritative. Do not split escaped commas inside an RDN.
  const components:string[]=[],labels:string[]=[]
  let start=0,escaped=false
  for(let i=0;i<dn.length;i++){
    if(escaped)escaped=false
    else if(dn[i]==='\\')escaped=true
    else if(dn[i]===','){components.push(dn.slice(start,i).trim());start=i+1}
  }
  components.push(dn.slice(start).trim())
  for(const rdn of components.reverse()){const match=names.exec(rdn);if(!match)break;labels.unshift(match[1].toLowerCase())}
  return labels.join('.')
}
export function snapshotDirectoryObject(rows:Attribute[]):DirectorySnapshot|undefined {
  const identity=(key:string)=>rows.find(r=>r.name.toLowerCase()===key)?.values?.[0]?.trim()
  const raw=identity('objectguid')||'',guid=raw.replace(/^\{([a-f\d-]+)\}$/i,'$1').toLowerCase()
  const dn=identity('distinguishedname')||'',domain=domainFromDn(dn)
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(guid)||!domain||domain.length>253)return
  const attributes=Object.fromEntries(rows.filter(r=>textual.has(r.name.toLowerCase())).map(r=>[r.name.toLowerCase(),r.values||[]]))
  return {guid,domain,dn,attributes}
}
const production=z.object({found:z.boolean(),controller:z.string(),values:z.record(z.string(),z.array(z.string())).optional()})
export type ProductionDirectoryRow=z.infer<typeof production>
export function compareDirectoryValues(snapshot:DirectorySnapshot,live:ProductionDirectoryRow){
  const attributes=live.found?Object.entries(snapshot.attributes).map(([name,backup])=>{
    const current=live.values?.[name]??null
    const same=current!==null&&JSON.stringify([...backup].sort())===JSON.stringify([...current].sort())
    return {name,backup,current,state:current===null?'unreported':same?'same':'changed'}
  }).sort((a,b)=>a.name.localeCompare(b.name)):[]
  return {found:live.found,controller:live.controller,attributes}
}

// A fixed PowerShell program reads request data from stdin. No request strings or
// credentials become executable text, command-line arguments, logs, or files.
export const directoryReadScript=String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
  Add-Type -AssemblyName System.DirectoryServices
  Add-Type -AssemblyName System.DirectoryServices.Protocols
  $inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $domain = [DirectoryServices.ActiveDirectory.Domain]::GetComputerDomain()
  if ($domain.Name -ine $inputData.domain) { throw 'domain' }
  $dc = $domain.FindDomainController()
  $serverName = $dc.Name.TrimEnd('.')
  if (-not $serverName.EndsWith('.'+$domain.Name,[StringComparison]::OrdinalIgnoreCase)) { throw 'domain' }
  $target = [DirectoryServices.Protocols.LdapDirectoryIdentifier]::new($serverName,636,$true,$false)
  $client = [DirectoryServices.Protocols.LdapConnection]::new($target)
  $client.SessionOptions.SecureSocketLayer = $true
  $client.SessionOptions.ProtocolVersion = 3
  $client.SessionOptions.ReferralChasing = [DirectoryServices.Protocols.ReferralChasingOptions]::None
  $client.Timeout = [TimeSpan]::FromSeconds(8)
  $client.AuthType = [DirectoryServices.Protocols.AuthType]::Basic
  $client.Credential = [Net.NetworkCredential]::new($inputData.username,$inputData.password)
  $client.Bind()
  $baseRequest = [DirectoryServices.Protocols.SearchRequest]::new('','(objectClass=*)',[DirectoryServices.Protocols.SearchScope]::Base,[string[]]@('defaultNamingContext'))
  $baseResponse = $client.SendRequest($baseRequest)
  $namingContext = [string]$baseResponse.Entries[0].Attributes['defaultNamingContext'][0]
  $expected = ($domain.Name.Split('.') | ForEach-Object {'DC='+$_}) -join ','
  if ($namingContext -ine $expected) { throw 'domain' }
  $guidBytes = ([guid]$inputData.guid).ToByteArray()
  $guidFilter = ($guidBytes | ForEach-Object {'\'+$_.ToString('x2')}) -join ''
  $query = [DirectoryServices.Protocols.SearchRequest]::new($namingContext,'(objectGUID='+$guidFilter+')',[DirectoryServices.Protocols.SearchScope]::Subtree,[string[]]$inputData.attributes)
  $query.SizeLimit = 2
  $query.TimeLimit = [TimeSpan]::FromSeconds(8)
  $response = $client.SendRequest($query)
  if ($response.Entries.Count -gt 1) { throw 'lookup' }
  $values = @{}
  if ($response.Entries.Count -eq 1) {
    foreach ($key in $inputData.attributes) {
      $attribute = $response.Entries[0].Attributes[$key]
      if ($null -ne $attribute) { $values[$key] = @($attribute.GetValues([string])) }
    }
  }
  [Console]::WriteLine((@{found=($response.Entries.Count -eq 1);controller=$serverName;values=$values} | ConvertTo-Json -Compress -Depth 5))
} catch {
  if ($_.Exception.Message -eq 'domain') {[Console]::WriteLine('{"error":"domain"}')}
  else {[Console]::WriteLine('{"error":"unavailable"}')}
} finally {if ($null -ne $client) {$client.Dispose()};if ($null -ne $dc) {$dc.Dispose()};if ($null -ne $domain) {$domain.Dispose()}}
`
export async function readProductionDirectory(snapshot:DirectorySnapshot,username:string,password:string):Promise<ProductionDirectoryRow>{
  if(process.platform!=='win32')throw new VbrRecoveryError('Open this restore point in Veeam Explorer for Microsoft Active Directory to compare with production.',409)
  const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe')
  const payload=JSON.stringify({domain:snapshot.domain,guid:snapshot.guid,attributes:Object.keys(snapshot.attributes),username,password})
  const raw=await new Promise<string>((resolve,reject)=>{
    const child=spawn(executable,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(directoryReadScript,'utf16le').toString('base64')],
      {shell:false,windowsHide:true,stdio:['pipe','pipe','ignore']})
    const chunks:Buffer[]=[];let length=0
    const fail=()=>reject(new VbrRecoveryError('Unable to read the production directory. Check the LDAPS certificate, domain connectivity and read account.',502))
    const timeout=setTimeout(()=>{child.kill();fail()},25000)
    child.on('error',()=>{clearTimeout(timeout);fail()})
    child.stdout.on('data',(chunk:Buffer)=>{length+=chunk.length;if(length>2*1024*1024){child.kill();fail()}else chunks.push(chunk)})
    child.once('close',code=>{clearTimeout(timeout);if(code===0)resolve(Buffer.concat(chunks).toString('utf8'));else fail()})
    child.stdin.on('error',fail);child.stdin.end(payload,'utf8')
  })
  let value:unknown
  try{value=JSON.parse(raw)}catch{/* Windows did not return a usable directory result. */}
  if(value&&typeof value==='object'&&'error' in value&&value.error==='domain')throw new VbrRecoveryError('The backup domain must match the Windows application host’s joined domain.',409)
  const parsed=production.safeParse(value)
  if(!parsed.success)throw new VbrRecoveryError('Unable to read the production directory. Check the LDAPS certificate, domain connectivity and read account.',502)
  return parsed.data
}
