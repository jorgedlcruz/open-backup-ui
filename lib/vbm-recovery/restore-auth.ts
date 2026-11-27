// Open Backup UI v1.3.0
import { z } from 'zod'
import { RecoveryError,isRecoveryError,record,regionSchema,sessionBase,type Workload } from './model'
import type { Execute } from './transport'

export type RestoreAuthenticationSettings={organizationName:string;organizationType?:'Office365'|'OnPremises'|'Hybrid';applicationId?:string;certificateThumbprint?:string;region?:z.infer<typeof regionSchema>;passwordAllowed:boolean}
export type RestoreDeviceCode={userCode:string;verificationUrl:string;expiresIn:number;message?:string}

const uuid=(value:unknown)=>{const parsed=z.string().uuid().safeParse(value);return parsed.success?parsed.data:undefined}
const text=(value:unknown)=>typeof value==='string'?value:undefined

/** Only non-secret connection hints cross into the browser. Never return the organization settings object. */
export function restoreAuthenticationSettings(value:unknown,workload:Workload):RestoreAuthenticationSettings {
  const raw=record(value),exchange=record(raw.exchangeOnlineSettings),sharePoint=record(raw.sharePointOnlineSettings)
  const type=['Office365','OnPremises','Hybrid'].includes(String(raw.type))?raw.type as RestoreAuthenticationSettings['organizationType']:undefined
  const candidates=workload==='Exchange'?[uuid(exchange.applicationId)]:workload==='Teams'?[uuid(exchange.applicationId),uuid(sharePoint.applicationId)]:[uuid(sharePoint.applicationId)]
  const applications=[...new Set(candidates.filter((id):id is string=>!!id))]
  const thumbprint=workload==='Exchange' && exchange.useApplicationOnlyAuth===true && applications.length===1
    ? text(exchange.applicationCertificateThumbprint)?.trim()
    : undefined
  const region=regionSchema.safeParse(raw.region)
  const onPremises=type==='OnPremises'||type==='Hybrid'&&(workload==='Exchange'?raw.isExchangeOnline===false&&raw.isExchange===true:workload==='SharePoint'&&raw.isSharePointOnline===false&&raw.isSharepoint===true)
  return {
    organizationName:text(raw.officeName)||text(raw.name)||'',
    ...(type?{organizationType:type}:{}),
    ...(applications.length===1?{applicationId:applications[0]}:{}),
    ...(thumbprint && /^[a-f0-9]{40}$/i.test(thumbprint)?{certificateThumbprint:thumbprint.toUpperCase()}:{}),
    ...(region.success?{region:region.data}:{}),
    passwordAllowed:!!onPremises&&['Exchange','SharePoint'].includes(workload),
  }
}

export async function loadRestoreAuthentication(execute:Execute,sessionId:string,workload:Workload,knownOrganizationId?:string,sessionOrganization?:string) {
  let organizationId=uuid(knownOrganizationId)
  if(!organizationId) {
    try {organizationId=uuid(record(await execute(`${sessionBase(sessionId)}/organization`)).id)}
    catch(error) {if(!isRecoveryError(error)||error.status!==404||!sessionOrganization)throw error}
  }
  if(!organizationId&&sessionOrganization?.trim()) {
    // Native Explorer sessions can expose only the organization name. Offer a hint only for
    // an exact, unique match in the configured source's complete organization listing.
    const listing=record(await execute('/v8/Organizations?extendedView=false&limit=1000'))
    if(Array.isArray(listing.results)&&listing.results.length<1000&&!record(listing._links).next) {
      const name=sessionOrganization.trim().toLowerCase()
      const matches=listing.results.map(record).filter(org=>[org.name,org.officeName].some(alias=>text(alias)?.trim().toLowerCase()===name))
      if(matches.length===1)organizationId=uuid(matches[0].id)
    }
  }
  if(!organizationId)throw new RecoveryError('The restore organization could not be identified. Enter the application ID manually.',502)
  return restoreAuthenticationSettings(await execute(`/v8/Organizations/${organizationId}`),workload)
}

export function normalizeRestoreDeviceCode(value:unknown):RestoreDeviceCode {
  const raw=record(value),parsed=z.object({userCode:z.string().min(1).max(128),verificationUrl:z.string().url(),expiresIn:z.number().int().positive().max(86400),message:z.string().optional()}).parse(raw)
  const url=new URL(parsed.verificationUrl)
  if(url.protocol!=='https:')throw new RecoveryError('Veeam returned an invalid sign-in address.',502)
  return parsed
}

/** Restore codes are owned by Explorer. Organization /DeviceCode/check cannot verify them.
 * The application is selected when requesting the code; the restore operation receives userCode.
 * Keep a truthful capability response for older clients; never claim authentication or probe a restore. */
export function restoreCodeVerificationCapability(userCode:string) {
  z.string().trim().min(1).max(128).parse(userCode)
  return {verificationAvailable:false} as const
}
