import { request } from 'node:https'
import { isIP } from 'node:net'
import { XmlDocument, type XmlElement } from 'xmldoc'
import { VbrRecoveryError } from '../recovery/error'
import type { VmwareDestination } from '../activity/vmware-destination'
import type { VmwareConsoleConnection } from './vmware-console-connections'

type Endpoint = Pick<VmwareConsoleConnection, 'hostname' | 'port' | 'caPem'>
type Reply = { result?: XmlElement; cookie?: string }
const badReply = () => new VbrRecoveryError('VMware returned an unexpected console response.', 502)
const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const ref = (type: string, value: string) => '<_this type="' + type + '">' + escapeXml(value) + '</_this>'

function children(parent: XmlElement | undefined, localName: string) {
  const found: XmlElement[] = []
  parent?.eachChild(child => { if (child.name.split(':').pop() === localName) found.push(child) })
  return found
}
const field = (parent: XmlElement | undefined, name: string) => children(parent, name)[0]?.val

async function soap(endpoint: Endpoint, operation: string, argumentsXml: string, signal: AbortSignal, cookie?: string): Promise<Reply> {
  const xml = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><' + operation +
    ' xmlns="urn:vim25">' + argumentsXml + '</' + operation + '></s:Body></s:Envelope>'
  // A fresh HTTPS request has its own TLS policy even if the VBR adapter allows self-signed certificates.
  const {body, status, cookies} = await new Promise<{body:string; status:number; cookies?:string[]}>((resolve, reject) => {
    const req = request({hostname:endpoint.hostname, port:endpoint.port, path:'/sdk', method:'POST', agent:false,
      rejectUnauthorized:true, ca:endpoint.caPem, signal, headers:{'Content-Type':'text/xml; charset=utf-8',
        SOAPAction:'"urn:vim25/6.0"', 'Content-Length':Buffer.byteLength(xml), ...(cookie ? {Cookie:cookie} : {})}}, res => {
      let length = 0
      const chunks: Buffer[] = []
      res.on('data', (chunk:Buffer) => {
        length += chunk.length
        if (length > 1024 * 1024) { req.destroy(badReply()); return }
        chunks.push(chunk)
      })
      res.on('error', reject)
      res.on('end', () => resolve({body:Buffer.concat(chunks).toString('utf8'), status:res.statusCode || 502, cookies:res.headers['set-cookie']}))
    })
    req.on('error', reject)
    req.end(xml)
  }).catch(() => { throw new VbrRecoveryError('Could not reach VMware over trusted HTTPS. Check the manager address and its certificate.', 502) })
  if (body.includes('<!DOCTYPE') || body.includes('<!ENTITY')) throw badReply()
  let doc: XmlDocument
  try { doc = new XmlDocument(body) } catch { throw badReply() }
  const payload = children(doc, 'Body')[0]
  const fault = children(payload, 'Fault')[0]
  if (status !== 200 || fault) {
    const detail = children(fault, 'detail')[0]
    if (status === 401 || children(detail, 'InvalidLoginFault').length) throw new VbrRecoveryError('VMware rejected the console connection credentials.', 403)
    if (status === 403 || children(detail, 'NoPermissionFault').length) throw new VbrRecoveryError('The VMware account lacks permission to open this console.', 403)
    if (children(detail, 'InvalidPowerStateFault').length || children(detail, 'ManagedObjectNotFoundFault').length) {
      throw new VbrRecoveryError('The recovered VM is no longer available for a console. Refresh the recovery session.', 409)
    }
    throw new VbrRecoveryError('VMware could not complete the console request.', 502)
  }
  const response = children(payload, operation + 'Response')[0]
  if (!response) throw badReply()
  const sessionCookie = cookies?.map(line => line.split(';')[0]).find(pair => /^vmware_soap_session=(?:"[^"\s;]+"|[^"\s;]+)$/i.test(pair))
  return {result:children(response, 'returnval')[0], cookie:sessionCookie}
}

async function serviceContent(endpoint: Endpoint, signal: AbortSignal) {
  const {result, cookie} = await soap(endpoint, 'RetrieveServiceContent', ref('ServiceInstance', 'ServiceInstance'), signal)
  const about = children(result, 'about')[0]
  const sessionManager = field(result, 'sessionManager'), collector = field(result, 'propertyCollector'), apiType = field(about, 'apiType')
  if (!sessionManager || !collector || !['VirtualCenter','HostAgent'].includes(apiType || '')) throw badReply()
  return {sessionManager, collector, cookie, provider:apiType === 'VirtualCenter' ? 'vcenter' : 'esxi', instanceUuid:field(about, 'instanceUuid')}
}

export async function getVcenterInstanceUuid(endpoint: Endpoint, signal: AbortSignal) {
  const content = await serviceContent(endpoint, AbortSignal.any([signal, AbortSignal.timeout(4500)]))
  return content.provider === 'vcenter' ? content.instanceUuid : undefined
}

async function withSession<T>(connection: VmwareConsoleConnection, signal: AbortSignal | undefined,
  operation: (content: Awaited<ReturnType<typeof serviceContent>>, cookie:string, signal:AbortSignal) => Promise<T>) {
  const deadline = AbortSignal.timeout(18000)
  const active = signal ? AbortSignal.any([deadline, signal]) : deadline
  const content = await serviceContent(connection, active)
  const manager = ref('SessionManager', content.sessionManager)
  const login = await soap(connection, 'Login', manager + '<userName>' + escapeXml(connection.username) +
    '</userName><password>' + escapeXml(connection.password) + '</password>', active, content.cookie)
  const cookie = login.cookie || content.cookie
  if (!cookie) throw badReply()
  try { return await operation(content, cookie, active) }
  finally { await soap(connection, 'Logout', manager, AbortSignal.timeout(2500), cookie).catch(() => undefined) }
}

export async function verifyVmwareConsoleConnection(connection: VmwareConsoleConnection, signal?: AbortSignal) {
  await withSession(connection, signal, async () => undefined)
}

function vmProperties(result: XmlElement | undefined, target: VmwareDestination) {
  const objects = children(result, 'objects'), object = children(objects[0], 'obj')[0]
  if (objects.length !== 1 || object?.attr.type !== 'VirtualMachine' || object.val !== target.vmId) throw badReply()
  const props = new Map(children(objects[0], 'propSet').map(p => [field(p, 'name'), field(p, 'val')]))
  if (props.get('name') !== target.vmName || props.get('runtime.powerState') !== 'poweredOn') {
    throw new VbrRecoveryError('The recovered VM is no longer available for a console. Refresh the recovery session.', 409)
  }
}

function websocketUrl(result: XmlElement | undefined, target: VmwareDestination) {
  const rawUrl = field(result, 'url'), secret = field(result, 'ticket')
  const answerHost = field(result, 'host')
  const host = answerHost && answerHost !== '*' ? answerHost : target.runtimeHost || (target.provider === 'esxi' ? target.server : undefined)
  const port = Number(field(result, 'port') || 443)
  let url: URL
  try {
    if (rawUrl) {
      url = new URL(rawUrl)
    } else {
      if (!secret || !host || !Number.isInteger(port) || port < 1 || port > 65535 || /[\s/@?#\\]/.test(host)) throw badReply()
      const authority = isIP(host) === 6 ? '[' + host + ']' : host
      url = new URL('wss://' + authority + ':' + port + '/ticket/' + encodeURIComponent(secret))
    }
  } catch { throw badReply() }
  // Only the TLS-verified VMware service supplies this URI. It is delivered once in the POST response.
  if (url.protocol !== 'wss:' || !url.hostname || url.username || url.password || url.hash || url.pathname === '/' || url.href.length > 16384) throw badReply()
  return url.href
}

export async function issueVmwareConsoleTicket(connection: VmwareConsoleConnection, target: VmwareDestination, signal?: AbortSignal) {
  if (connection.hostname !== target.server || connection.port !== target.port || target.powerState !== 'PoweredOn') {
    throw new VbrRecoveryError('The recovered VM is no longer available for a console. Refresh the recovery session.', 409)
  }
  return withSession(connection, signal, async (content, cookie, active) => {
    if (content.provider !== target.provider) throw badReply()
    const id = escapeXml(target.vmId)
    const spec = '<specSet><propSet><type>VirtualMachine</type><pathSet>name</pathSet><pathSet>runtime.powerState</pathSet></propSet>' +
      '<objectSet><obj type="VirtualMachine">' + id + '</obj></objectSet></specSet><options/>'
    const props = await soap(connection, 'RetrievePropertiesEx', ref('PropertyCollector', content.collector) + spec, active, cookie)
    vmProperties(props.result, target)
    const ticket = await soap(connection, 'AcquireTicket', ref('VirtualMachine', target.vmId) + '<ticketType>webmks</ticketType>', active, cookie)
    return {name:target.vmName, url:websocketUrl(ticket.result, target)}
  })
}
