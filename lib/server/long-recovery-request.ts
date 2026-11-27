// Open Backup UI v1.3.0
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'

// Keep the caller's abort deadline while Veeam prepares its response headers.
function openRequest(url: URL, method:'GET'|'POST', headers: Record<string,string|number>, body:string|undefined, signal:AbortSignal):Promise<IncomingMessage> {
  return new Promise((resolve,reject)=>{
    const send=url.protocol==='https:'?httpsRequest:httpRequest
    const request=send(url,{method,headers,signal},resolve)
    request.on('error',reject)
    request.end(body)
  })
}

export async function sendLongRecoveryRead(url:URL, headers:Record<string,string>, signal:AbortSignal):Promise<Response> {
  const response=await openRequest(url,'GET',{...headers,'Accept-Encoding':'identity'},undefined,signal)
  const status=response.statusCode || 502
  if([301,302,303,307,308].includes(status) && response.headers.location) {
    response.destroy()
    throw new Error('Unexpected redirect from recovery source')
  }
  const responseHeaders=new Headers()
  for(const [key,value] of Object.entries(response.headers)) {
    if(typeof value==='string')responseHeaders.set(key,value)
    else if(value)for(const item of value)responseHeaders.append(key,item)
  }
  if([204,205,304].includes(status)) {response.resume();return new Response(null,{status,headers:responseHeaders})}
  // A proxy can return an encoded body even when the client asks for identity.
  const encoding=response.headers['content-encoding']?.toLowerCase()
  const decoder=encoding==='gzip'?createGunzip():encoding==='deflate'?createInflate():encoding==='br'?createBrotliDecompress():undefined
  const stream=Readable.toWeb(decoder?response.compose(decoder):response) as ReadableStream<Uint8Array>
  return new Response(stream,{status,headers:responseHeaders})
}

export async function sendLongRestore(url: URL, headers: Record<string,string>, body: string | undefined, signal: AbortSignal): Promise<Response> {
  const response=await openRequest(url,'POST',{...headers,'Content-Length':Buffer.byteLength(body || '')},body,signal)
  return new Promise((resolve,reject)=>{
    const chunks: Buffer[] = []
    let length = 0
    response.on('data', (chunk: Buffer) => {
      length += chunk.length
      if (length > 1024 * 1024) response.destroy(new Error('Recovery response exceeds maximum size'))
      else chunks.push(chunk)
    })
    response.on('error', reject)
    response.on('end', () => {
      const status = response.statusCode || 502
      resolve(new Response([204,205,304].includes(status) ? null : Buffer.concat(chunks).toString('utf8'), {status}))
    })
  })
}
