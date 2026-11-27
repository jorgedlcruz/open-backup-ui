// Open Backup UI v1.3.0
import { sendLongRecoveryRead, sendLongRestore } from '../server/long-recovery-request'
import { RecoveryError } from './model'
import { readRetryDelay, waitForReadRetry } from './read-retry'
import { browseProxyWaitMs } from './proxy-wait-policy'

// VB365 may expose item statistics only after its restore session completes.
export class RestoreStatisticsPendingError extends RecoveryError {
  constructor(){super('Restore statistics are available after the session completes.',409)}
}

export type Execute=(path:string,method?:'GET'|'POST',body?:unknown,browseDeadline?:number)=>Promise<unknown>
type Options={baseUrl:string;token:string;refresh:()=>Promise<string|null>;fetcher?:typeof fetch;signal?:AbortSignal;readTimeoutMs?:number;writeTimeoutMs?:number;browseStartTimeoutMs?:number}
const requiredRestoreOptions=new Map([
  ['MarkRestoredAsUnread','mark restored items as unread'],['Mailbox','destination mailbox'],['Folder','destination folder'],
  ['Items','selected items'],['Documents','selected documents'],['Folders','selected folders'],['SiteURL','destination site'],['List','destination list'],
  ['DocumentAction','existing document handling'],['DocumentVersion','versions to restore'],['DocumentLastVersionAction','existing version handling'],
  ['RestorePermissions','restore permissions'],['SendSharedLinksNotification','shared link notifications'],
  ['RestoreMissingItems','restore missing items'],['RestoreChangedItems','restore changed items'],
  ['DeletedItems','restore missing items'],['ChangedItems','restore changed items'],['ImpersonationAccountName','Exchange impersonation account'],
])
function missingRestoreOptions(message:unknown):string|undefined {
  if(typeof message!=='string'||message.length>512)return
  const match=/^Missing mandatory parameters: ([A-Za-z][A-Za-z0-9]*(?:, [A-Za-z][A-Za-z0-9]*)*)\.$/.exec(message)
  if(!match||match[0]!==message)return
  const names=match[1].split(', '),labels=names.map(name=>requiredRestoreOptions.get(name))
  if(labels.some(label=>!label))return
  return `The restore request is missing required options: ${[...new Set(labels)].join(', ')}. Review the restore options and try again.`
}
export function assertRecoveryOrigin(requestOrigin:string|null,applicationOrigin:string,fetchSite:string|null) {
  if(requestOrigin!==applicationOrigin || fetchSite==='cross-site')throw new RecoveryError('Recovery actions must originate from this application.',403)
}
/** Fixed-source transport. Paths are produced by typed recovery builders, never passed through from browser URLs. */
export function recoveryTransport(options:Options):Execute {
  const base=new URL(options.baseUrl)
  if(!['https:','http:'].includes(base.protocol) || base.username || base.password)throw new RecoveryError('Invalid Microsoft 365 source configuration.')
  let token=options.token,refreshing:Promise<string|null>|null=null
  return async(path,method='GET',body,browseDeadline)=>{
    const proxyStatus=method==='GET' && /^\/v8\/(?:Proxies\/[\da-f-]{36}$|ProxyPools\/[\da-f-]{36}\/proxies(?:\?|$))/i.test(path)
    if(!proxyStatus && !(method==='GET' && /^\/v8\/JobSessions(?:\?|$)/.test(path)) && !/^\/v8\/(RestoreSessions|RestorePoints|Protected(?:Users|Groups|Sites|Teams)|Organizations|BackupRepositories|DataRetrievals)(?:\/|\?|$)/.test(path) || path.includes('://') || /[\r\n#]/.test(path))throw new RecoveryError('Unsupported recovery resource.')
    const destination=new URL(path,base)
    if(destination.origin!==base.origin)throw new RecoveryError('Invalid recovery destination.')
    // Listing mailboxes, folders and messages can read a cold object-storage backup.
    const exchangeListing=method==='GET' && /^\/v8\/RestoreSessions\/[\da-f-]+\/organization\/mailboxes(?:\/[^/]+\/(?:folders|items))?$/i.test(destination.pathname)
    const readTimeout=options.readTimeoutMs ?? (exchangeListing?12*60_000:60000)
    const browseStart=method==='POST' && /^\/v8\/(?:Organizations|BackupRepositories|DataRetrievals)\/[^/]+\/explore$/i.test(destination.pathname)
    const writeTimeout=browseStart ? options.browseStartTimeoutMs ?? browseProxyWaitMs : options.writeTimeoutMs ?? 180000
    const timeRemaining = browseDeadline === undefined ? Infinity : browseDeadline-Date.now()
    if(timeRemaining<=0)throw new RecoveryError('The 30-minute wait expired before the backup could be opened.',504)
    const controller=new AbortController(),timeoutMs=Math.min(method==='POST' ? writeTimeout:readTimeout,timeRemaining)
    const deadline=Date.now()+timeoutMs,timer=setTimeout(()=>controller.abort(),timeoutMs)
    const abort=()=>controller.abort()
    // Once a write begins it must produce a receipt even if its browser disconnects.
    if(method==='GET') {options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)controller.abort()}
    try {
      const send=()=>{
        controller.signal.throwIfAborted()
        const headers={Authorization:`Bearer ${token}`,Accept:'application/json',...(body!==undefined ? {'Content-Type':'application/json'}:{})}
        if(exchangeListing && !options.fetcher)return sendLongRecoveryRead(destination,headers,controller.signal)
        if(browseStart && !options.fetcher)return sendLongRestore(destination,headers,body===undefined?undefined:JSON.stringify(body),controller.signal)
        return (options.fetcher || fetch)(destination,{method,headers,...(method==='POST' && body!==undefined ? {body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error',signal:controller.signal})
      }
      let retriedRead=false,refreshedAuthentication=false
      while(true) {
        let response:Response
        try {
          response=await send()
          // An explicit authentication rejection means the operation did not run. Never retry ambiguous writes.
          if(response.status===401 && !refreshedAuthentication) {
            refreshedAuthentication=true
            refreshing ||= options.refresh()
            const fresh=await refreshing
            if(fresh){
              if(exchangeListing)await response.body?.cancel().catch(()=>{})
              token=fresh;response=await send()
            }
          }
        }catch(error) {
          const delay=method==='GET' && !retriedRead && !controller.signal.aborted ? readRetryDelay(undefined,null,deadline):null
          if(delay===null)throw error
          retriedRead=true
          await waitForReadRetry(delay,controller.signal)
          continue
        }
        const delay=method==='GET' && !retriedRead && !controller.signal.aborted && !response.ok ? readRetryDelay(response.status,response.headers.get('Retry-After'),deadline):null
        if(delay!==null) {
          retriedRead=true
          await response.body?.cancel().catch(()=>{})
          await waitForReadRetry(delay,controller.signal)
          continue
        }
        if(!response.ok) {
          // Keep the documented diagnostic code, never echo vendor messages or stack traces containing credentials.
          const payload=await response.json().catch(()=>null)
          // Recognize this one documented resource's observed capability response without exposing upstream text.
          if(method==='GET' && /^\/v8\/RestoreSessions\/[0-9a-f-]+\/Statistics$/i.test(path) && response.status===409 && typeof payload?.message==='string' && /^Unable to provide statistics until the restore session completes\.?$/i.test(payload.message.trim()))throw new RestoreStatisticsPendingError()
          const code=payload && typeof payload==='object' && typeof payload.errorCode==='string' && ['ProxyOffline','OutdatedChangeToken','ResourceAccessDenied','ResourceNotFound','ParameterValidationFailure','OrganizationTransfer','RepositoryOwnerChangeTooManyLinks','Timeout','OperationConflict','HttpError'].includes(payload.errorCode) ? payload.errorCode:undefined
          // Only a precise validation grammar and static option labels may cross this boundary.
          const missing=method==='POST'&&response.status===400&&code==='ParameterValidationFailure'&&/^\/v8\/RestoreSessions\/[0-9a-f-]+\/.+\/(?:restore|restoreTo|copyTo)$/i.test(path)?missingRestoreOptions(payload.message):undefined
          if(missing)throw new RecoveryError(missing,400,false)
          if(browseStart && (response.status===400 || response.status===409) && code==='ProxyOffline')
            throw new RecoveryError('Veeam rejected the browse start because the backup proxy is offline.',response.status,false,'ProxyOffline')
          throw new RecoveryError(response.status===401 ? 'Your Microsoft 365 session has expired. Reconnect the data source.' : response.status===403 ? 'The Microsoft 365 source denied this operation. Check the account permissions.' : `The Microsoft 365 source rejected the ${method==='POST' ? 'operation':'request'} (HTTP ${response.status})${code ? ` · ${code}`:''}.`,[400,401,403,404,409,429].includes(response.status) ? response.status:502,method==='POST' && response.status>=500,method==='GET' && response.status===404 && code==='ResourceNotFound' ? 'ResourceNotFound':undefined)
        }
        if(response.status===204)return {accepted:true}
        const text=await response.text()
        if(text.length>16*1024*1024)throw new RecoveryError('The recovery response is too large. Narrow the request.',502,method==='POST')
        if(!text.trim())return {accepted:true}
        try {return JSON.parse(text)}catch{throw new RecoveryError('The Microsoft 365 source returned an invalid receipt.',502,method==='POST')}
      }
    }catch(error) {
      if(error instanceof RecoveryError)throw error
      if(method==='GET' && options.signal?.aborted)throw new RecoveryError('The recovery request was cancelled.',499)
      throw new RecoveryError(method==='POST' ? 'The operation outcome is unconfirmed. Check restore sessions before retrying.' : controller.signal.aborted ? 'Loading took too long. Retry to continue.' : 'Microsoft 365 recovery data could not be loaded.',controller.signal.aborted ? 504:502,method==='POST')
    }finally {clearTimeout(timer);options.signal?.removeEventListener('abort',abort)}
  }
}
