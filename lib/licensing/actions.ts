import { z } from 'zod'
import { opaqueId } from '../vbm-protected/model'
import { validId } from '../investigation/model'
import { type Platform } from './model'
const revokeSchema=z.object({id:opaqueId,kind:z.enum(['instances','sockets','capacity','user'])}).strict()
const reportSchema=z.object({startTime:z.iso.datetime({offset:true}),endTime:z.iso.datetime({offset:true}),format:z.literal('PDF').optional(),timezone:z.enum(['GMT','UTC']).optional()}).strict()
export type Operation={path:string;method:'POST'|'DELETE';body?:unknown;format:'accepted'|'html'|'pdf'}
export function operation(platform:Platform,action:'revoke'|'report',input:unknown):Operation {
  if(action==='revoke'){
    const {id,kind}=revokeSchema.parse(input)
    if(platform==='vbr'){if(kind==='user' || !validId(id))throw Error('Invalid VBR license consumer.');return {path:`/api/v1/license/${kind}/${encodeURIComponent(id)}/revoke`,method:'POST',format:'accepted'}}
    if(kind!=='user')throw Error('Invalid Microsoft 365 license consumer.')
    return {path:`/v8/LicensedUsers/${encodeURIComponent(id)}`,method:'DELETE',format:'accepted'}
  }
  if(action!=='report')throw Error('Invalid licensing action.')
  if(platform==='vbr')return {path:'/api/v1/license/createReport',method:'POST',body:{reportFormat:'html'},format:'html'}
  const value=reportSchema.parse(input)
  if(Date.parse(value.endTime)<=Date.parse(value.startTime))throw Error('Report end must follow its start.')
  return {path:'/v8/Reports/GenerateLicenseOverview',method:'POST',body:{...value,format:'PDF',timezone:'UTC'},format:'pdf'}
}
