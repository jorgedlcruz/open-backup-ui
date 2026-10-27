import { z } from 'zod'

export const statuses = ['Error', 'Warning', 'Information', 'Acknowledged', 'Resolved', 'Success', 'Remediated', 'Unknown'] as const
export const ranges = { '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', all: 'All retained time' }
export const issues: Record<string,string> = { all: 'All alarms', attention: 'Errors & warnings', aged: 'Errors/warnings >24h', unresolved: 'Unresolved', resolved: 'Resolved', unknown: 'Unknown status' }
export const text = (value: unknown) => typeof value === 'string' ? value : ''
export const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
export const id = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null
export const object = (value: unknown): Record<string,unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {}
export const dateMs = (value: string) => { const ms = Date.parse(/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(value) ? `${value}Z`:value); return Number.isFinite(ms) ? ms : null }
export const statusOf = (value: unknown): string => text(value) || 'Unknown'
export type Evidence<T> = { data: T; complete: boolean; error: string | null; total: number | null }
export type Alarm = {
  key: string; revision: string; triggeredAlarmId: number | null; triggeredSubAlarmId: number | null; alarmId: number | null;
  time: string; status: string; description: string; alarmName: string; alarmType: string; isVid: boolean | null;
  entityId: number | null; entityName: string; entityType: string; source: string; bpServerId: number | null;
  latitude: number | null; longitude: number | null; region: string; subregion: string; cityName: string; isCustomCity: boolean | null;
  remediation: { description: string; mode: string }[]; comment: string; repeatCount: number | null;
}
export function normalizeAlarm(value: unknown): Alarm {
  const row = object(value), alarm: Alarm = {
    key: '', revision: '', triggeredAlarmId: id(row.triggeredAlarmId), triggeredSubAlarmId: id(row.triggeredSubAlarmId), alarmId: id(row.alarmId),
    time: text(row.time), status: statusOf(row.status), description: text(row.description), alarmName: text(row.alarmName), alarmType: text(row.alarmType), isVid: typeof row.isVid === 'boolean' ? row.isVid : null,
    entityId: id(row.entityId), entityName: text(row.entityName), entityType: text(row.entityType), source: text(row.source), bpServerId: id(row.bpServerId),
    latitude: number(row.latitude), longitude: number(row.longitude), region: text(row.region), subregion: text(row.subregion), cityName: text(row.cityName), isCustomCity: typeof row.isCustomCity === 'boolean' ? row.isCustomCity : null,
    remediation: Array.isArray(object(row.remediation).items) ? (object(row.remediation).items as unknown[]).map(value => { const entry = object(value); return { description: text(entry.description), mode: text(entry.mode) } }) : [], comment: text(row.comment), repeatCount: id(row.repeatCount),
  }
  const time = dateMs(alarm.time); if(time !== null)alarm.time = new Date(time).toISOString()
  alarm.key = JSON.stringify([alarm.triggeredAlarmId, alarm.triggeredSubAlarmId, alarm.time, alarm.status, alarm.entityId, alarm.entityType, alarm.isVid, alarm.source, alarm.description])
  return alarm
}
export type HistoryDay = { time: string; status: string; count: number }
export type Template = { id: number | null; name: string; type: string; enabled: boolean | null; predefined: boolean | null; summary: string; cause: string; resolution: string; custom: string; external: string }
export const filtersSchema = z.object({ range: z.enum(['24h','7d','30d','90d','all']).default('30d'), query: z.string().max(300).default(''), statuses: z.array(z.string().min(1).max(60)).max(12).default([]), issue: z.enum(['all','attention','aged','unresolved','resolved','unknown']).default('all'), type: z.string().max(150).default('all'), source: z.string().max(1000).default('all'), location: z.string().max(500).default('all'), entity: z.string().max(300).default('all'), from: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default(''), to: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default('') }).strict()
export type Filters = z.infer<typeof filtersSchema>
export const emptyFilters: Filters = { range: '30d', query: '', statuses: [], issue: 'all', type: 'all', source: 'all', location: 'all', entity: 'all', from: '', to: '' }
export type Snapshot = { current: Evidence<Alarm[]>; days: Evidence<HistoryDay[]>; history: Evidence<Alarm[]>; historyPage: number; sourceName: string; sourceKey: string; fetchedAt: string; filters: Filters }
export type Detail = { template: Evidence<Template | null>; history: Evidence<Alarm[]>; sourceKey: string }
export const isClosed = (status: string) => ['Resolved','Success','Remediated'].includes(status)
export const isAttention = (status: string) => status === 'Error' || status === 'Warning'
export const hasCoordinates = (row: Pick<Alarm,'latitude'|'longitude'>) => row.latitude !== null && row.longitude !== null && Math.abs(row.latitude) <= 90 && Math.abs(row.longitude) <= 180
export const locationName = (row: Pick<Alarm,'cityName'|'subregion'|'region'>) => [row.cityName,row.subregion,row.region].filter(Boolean).join(' · ') || 'Unreported location'
export const locationKey = (row: Pick<Alarm,'cityName'|'subregion'|'region'>) => JSON.stringify([row.cityName,row.subregion,row.region])
export const entityKey = (row: Alarm) => row.entityId !== null && row.entityType ? JSON.stringify([row.entityId,row.entityType,row.isVid]) : `unidentified:${row.key}`
export function startTime(range: Filters['range'], now: number) { const days = { '24h': 1, '7d': 7, '30d': 30, '90d': 90, all: 0 }[range]; return days ? now - days * 86400000 : null }
export function matchAlarm(row: Alarm, filters: Filters, now: number) {
  const ms = dateMs(row.time), start = startTime(filters.range, now)
  return (start === null || ms !== null && ms >= start) && (!filters.from || ms !== null && ms >= Date.parse(filters.from+'T00:00:00Z')) && (!filters.to || ms !== null && ms < Date.parse(filters.to+'T00:00:00Z')+86400000)
    && (!filters.statuses.length || filters.statuses.includes(row.status)) && (filters.type === 'all' || row.entityType === filters.type) && (filters.source === 'all' || row.source === filters.source) && (filters.location === 'all' || locationKey(row) === filters.location) && (filters.entity === 'all' || entityKey(row) === filters.entity)
    && `${row.alarmName} ${row.entityName} ${row.source} ${plainText(row.description)}`.toLowerCase().includes(filters.query.trim().toLowerCase())
    && (filters.issue === 'all' || filters.issue === 'attention' && isAttention(row.status) || filters.issue === 'aged' && isAttention(row.status) && ms !== null && now - ms >= 86400000 || filters.issue === 'unresolved' && ['Error','Warning','Information','Acknowledged'].includes(row.status) || filters.issue === 'resolved' && isClosed(row.status) || filters.issue === 'unknown' && (!statuses.includes(row.status as typeof statuses[number]) || row.status === 'Unknown'))
}
export function affectedObjects(rows: Alarm[]) {
  const groups = new Map<string,{ key: string; name: string; type: string; known: boolean; alarms: Alarm[] }>()
  for (const row of rows) { const key = entityKey(row), group = groups.get(key) || { key, name: row.entityName || 'Unreported object', type: row.entityType || 'Unknown', known: row.entityId !== null && !!row.entityType, alarms: [] }; group.alarms.push(row); groups.set(key,group) }
  return [...groups.values()].sort((a,b) => b.alarms.filter(row=>isAttention(row.status)).length - a.alarms.filter(row=>isAttention(row.status)).length || b.alarms.length-a.alarms.length || a.name.localeCompare(b.name))
}
export function plainText(html: string) {
  const entities: Record<string,string> = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ' }
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)').replace(/<br\s*\/?>|<\/(?:p|div|li|tr|h[1-6])\s*>/gi,'\n').replace(/<li\b[^>]*>/gi,'• ').replace(/<\/?(?:a|p|div|span|li|ul|ol|table|tbody|thead|tr|td|th|h[1-6]|b|strong|i|em|u|font|img|hr|pre|code|blockquote|br)\b[^>]*>/gi,'').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match,key:string) => { if (!key.startsWith('#')) return entities[key.toLowerCase()] || match; const code = parseInt(key.slice(key[1].toLowerCase()==='x' ? 2 : 1), key[1].toLowerCase()==='x' ? 16 : 10); return code > 0 && code <= 0x10ffff && !(code>=0xd800 && code<=0xdfff) ? String.fromCodePoint(code) : match }).trim()
}
export function historyBins(days: HistoryDay[], max = 60) {
  const grouped = new Map<string, Record<string,number>>()
  for (const row of days) { const ms=dateMs(row.time); if (ms === null || row.count < 0 || !Number.isFinite(row.count)) continue; const day = new Date(ms).toISOString().slice(0,10); const values = grouped.get(day) || {}; values[row.status] = (values[row.status] || 0) + row.count; grouped.set(day,values) }
  const sorted = [...grouped].sort(([a],[b]) => a.localeCompare(b)), size = Math.max(1, Math.ceil(sorted.length / max)), bins: {from:string;to:string;counts:Record<string,number>;total:number}[] = []
  for(let i=0;i<sorted.length;i+=size) { const slice=sorted.slice(i,i+size), counts:Record<string,number>={}; for(const [,values] of slice) for(const [key,value] of Object.entries(values)) counts[key]=(counts[key]||0)+value; bins.push({from:slice[0][0],to:slice[slice.length-1][0],counts,total:Object.values(counts).reduce((a,b)=>a+b,0)}) }
  return bins
}
