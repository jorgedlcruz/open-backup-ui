'use client'
// Open Backup UI v1.2.0
import { useVbmPresentation } from '@/components/vbm-jobs/presentation'
import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { type ProtectedObject,type Summary,coverage } from '@/lib/vbm-protected/model'
import ops from '@/components/operations/operations.module.css'
import shared from '@/components/vbm-dashboard/vbm-dashboard.module.css'

export function Badge({value}:{value:string}) {
  const {localLabel}=useVbmPresentation()



return <span className={cn(ops.badge,['Within threshold','Restore points available','Retained','Available'].includes(value) ? ops.success:['Outside threshold','No restore points','Deleted','Unavailable'].includes(value) ? ops.warning:ops.neutral)}><span className={ops.dot}/>{localLabel(value)}</span>}
export function Fact({label,children}:{label:string;children:ReactNode}) {
  const {t}=useVbmPresentation()



return <div><dt>{t(label as string)}</dt><dd>{children}</dd></div>}
export function SummaryFacts({value}:{value:Summary}) {
  const {t,formatNumber,date,localCount,diagnostic}=useVbmPresentation()



return <><Fact label="Coverage"><Badge value={coverage(value)}/></Fact><Fact label="Retained restore points">{localCount(value)}</Fact><Fact label="Latest confirmed backup">{date(value.latest)}</Fact><Fact label="Individual size">{t('Not reported by the protected-data API')}</Fact><Fact label="Copies / archives">{t('{copies} copies · {archives} archives (loaded)',{copies:formatNumber(value.copies),archives:formatNumber(value.archives)})}</Fact><Fact label="Evidence">{!value.available ? t('Unavailable'):value.complete ? t('All retained history loaded'):t('Partial history')}{value.unknownDeletion>0 && ` · ${t('{count} unknown deletion states',{count:formatNumber(value.unknownDeletion)})}`}{value.invalidDates>0 && ` · ${t('{count} invalid or future times',{count:formatNumber(value.invalidDates)})}`}{value.error && ` · ${diagnostic(value.error)}`}</Fact></>}
export function ObjectFacts({object}:{object:ProtectedObject}) {
  const {t,formatNumber,localLabel}=useVbmPresentation()



return <><dl className={shared.facts}><Fact label="Object type">{localLabel(object.type)}</Fact><Fact label="Account type">{object.accountType ? localLabel(object.accountType):t('Not reported')}</Fact><Fact label="Microsoft ID">{object.msid || t('Not reported')}</Fact><Fact label="Backed-up organization">{object.backedUpOrganizationId || t('Not reported')}</Fact><Fact label="Object ID">{object.id}</Fact><Fact label="URL / description">{[object.url,object.description].filter(Boolean).join(' · ') || t('Not reported')}</Fact></dl>{(['mailboxes','oneDrives','sites'] as const).map(key=><div key={key}><h3>{t('{category} ({count})',{category:key==='mailboxes' ? t('Mailboxes'):key==='oneDrives' ? 'OneDrive':t('Sites'),count:object[key]?formatNumber(object[key].length):t('Not reported')})}</h3>{object[key]?.map(item=><div className={shared.message} key={item.id}><strong>{item.displayName || item.id}</strong><p>{item.email || item.url || t('Address not reported')}</p><small>{item.id}{key==='mailboxes' ? ` · ${item.isArchive===true ? t('Archive mailbox'):item.isArchive===false ? t('Primary mailbox'):t('Mailbox kind not reported')}`:''}</small></div>)}</div>)}</>}
