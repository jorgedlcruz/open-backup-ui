// Open Backup UI v1.2.0
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { request } from 'node:https'
import type { VBRSource } from './config-store'
import type { RecoverySend } from './vbr-recovery'
import { VbrRecoveryError } from '../recovery/error'

// Explorer is served by the VBR web listener. Its token audience differs from the public REST API.
const salt = randomBytes(32)
const tokens = new Map<string, {until:number; value:Promise<string>}>()
// Use the same native HTTPS transport as long-running VBR requests. A private response
// is JSON (never a file); bound its size and do not follow credential-bearing redirects.
function jsonRequest(url:URL,method:string,headers:Record<string,string>,body:string|undefined,signal:AbortSignal) {
  return new Promise<{status:number;value:unknown}>((resolve,reject)=>{
    const req=request(url,{method,headers:{...headers,...(body!==undefined?{'Content-Length':String(Buffer.byteLength(body))}:{})},signal},res=>{
      const chunks:Buffer[]=[];let size=0
      res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>12*1024*1024) res.destroy(new Error('Explorer response too large'));else chunks.push(chunk)})
      res.on('error',reject)
      res.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8'),status=res.statusCode||502
        try {resolve({status,value:text?JSON.parse(text):null})} catch {if(status>=400)resolve({status,value:null});else reject(new Error('Invalid Explorer response'))}
      })
    });req.on('error',reject);req.end(body)
  })
}
type Source = Pick<VBRSource,'id'|'platform'|'protocol'|'host'|'username'|'password'>
export function explorerPrincipal(source:Source) {
  return createHash('sha256').update(JSON.stringify([source.id,source.host,source.username.toLowerCase()])).digest('hex')
}
function webOrigin(source:Source) {
  const port = Number(process.env.VBR_EXPLORER_HTTPS_PORT || 443)
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !source.host || /[/?#@\\\s]/.test(source.host)) throw new VbrRecoveryError('Invalid VBR web console configuration.', 503)
  const url = new URL('https://' + source.host); url.port = String(port)
  return url
}
export function explorerConnection(source: Source | undefined, signal:AbortSignal) {
  if (!source || source.platform !== 'vbr' || source.protocol !== 'https' || !source.username || !source.password) {
    throw new VbrRecoveryError('Application recovery requires an HTTPS VBR source with saved credentials for the connected account.',403)
  }
  const origin = webOrigin(source), principalKey = explorerPrincipal(source)
  const cacheId = createHmac('sha256',salt).update(JSON.stringify([origin.origin,principalKey,source.password])).digest('hex')
  async function token() {
    const now = Date.now()
    for (const [key,item] of tokens) if (item.until <= now) tokens.delete(key)
    const previous = tokens.get(cacheId)
    if (previous) return previous.value
    const entry = {until:now+25_000, value:Promise.resolve('')}
    entry.value = (async () => {
      try {
        const r = await jsonRequest(new URL('/private-api/oauth2/token',origin),'POST',
          {'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json','x-api-version':'1.3-rev2'},
          new URLSearchParams({grant_type:'password',username:source!.username,password:source!.password!}).toString(),AbortSignal.timeout(30_000))
        if (r.status!==200) throw new VbrRecoveryError('VBR web authentication failed. Check that the saved account can sign in to the VBR web console.',r.status===401||r.status===403?403:503)
        const body = r.value as {access_token?:string;expires_in?:number}|null
        if (typeof body?.access_token !== 'string' || !body.access_token) throw new Error()
        entry.until = now + Math.min(600_000, Math.max(1_000,(Number(body.expires_in)||60)*1000-30_000))
        return body.access_token as string
      } catch (err) {
        if(tokens.get(cacheId) === entry) tokens.delete(cacheId)
        if(err instanceof VbrRecoveryError) throw err
        throw new VbrRecoveryError('Cannot reach the VBR web console for application recovery. Check its HTTPS port and certificate.',503)
      }
    })()
    if(tokens.size >= 64) tokens.delete(tokens.keys().next().value!)
    tokens.set(cacheId,entry); return entry.value
  }
  const send:RecoverySend = async (path, {method='GET',body,mutation=false,archive=false}={}) => {
    const url = new URL(path,origin)
    if(archive || url.origin!==origin.origin || !/^\/(?:private-api|api)\/v1\//.test(url.pathname)) throw new VbrRecoveryError('Invalid VBR Explorer operation.')
    const run = async () => jsonRequest(url,method,
      {Authorization:'Bearer '+await token(),Accept:'application/json','x-api-version':'1.3-rev2',...(body!==undefined?{'Content-Type':'application/json'}:{})},
      body===undefined?undefined:JSON.stringify(body),AbortSignal.any([signal,AbortSignal.timeout(60_000)]))
    try {
      let r=await run()
      if(r.status===401) {
        tokens.delete(cacheId)
        if(!mutation) r=await run()
      }
      if(r.status<200 || r.status>=300) {
        const detail=r.value as {message?:string}|null
        throw new VbrRecoveryError(typeof detail?.message==='string'?detail.message.slice(0,700):'VBR Explorer returned HTTP '+r.status+'.',r.status>=500?502:r.status,mutation&&r.status>=500)
      }
      return r.value
    } catch(err) {
      if(err instanceof VbrRecoveryError) throw err
      throw new VbrRecoveryError(mutation?'The Explorer request could not be confirmed. Check Sessions before trying again.':'VBR Explorer could not be reached.',502,mutation)
    }
  }
  return {send,principalKey,origin:origin.origin}
}
