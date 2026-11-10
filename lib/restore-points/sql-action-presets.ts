// Open Backup UI v1.2.0
import type {SqlIntent} from '../recovery/sql-actions'

export type SqlRecoveryPreset={destination:'original'|'another';time:'latest'|'pointInTime'}
export type SqlActionScope='server'|'instance'|'databases'
type SourceDatabase={key:string;type:string;timeRange?:{from?:string;to?:string;startTime?:string;endTime?:string}}
type Choice={intent:SqlIntent;label:string;preset:SqlRecoveryPreset;disabledReason?:string}
type Group={label:string;choices:Choice[]}
const latest:SqlRecoveryPreset={destination:'original',time:'latest'}
const another:SqlRecoveryPreset={destination:'another',time:'latest'}
const point:SqlRecoveryPreset={destination:'original',time:'pointInTime'}

/** Native Explorer requires a continuous window longer than sixty seconds. */
export function sqlTimeWindow(databases:readonly SourceDatabase[]) {
  if(!databases.length)return
  const starts=databases.map(({timeRange})=>Date.parse(timeRange?.from||timeRange?.startTime||''))
  const ends=databases.map(({timeRange})=>Date.parse(timeRange?.to||timeRange?.endTime||''))
  const from=Math.max(...starts),to=Math.min(...ends)
  if(Number.isFinite(from)&&Number.isFinite(to)&&to-from>60000)return {from,to}
}

export function sqlActionGroups(scope:SqlActionScope,databases:readonly SourceDatabase[]):Group[] {
  if(!databases.length||databases.length>128||databases.some(db=>db.type!=='SQLDatabase'||!db.key))return []
  const canPickTime=!!sqlTimeWindow(databases)
  function recovery(intent:'instant'|'restore'):Choice[] {
    const choices:Choice[]=[{intent,label:'Latest state at original location',preset:latest}]
    // The native database menu hides PIT without logs. The instance/server menu
    // always lists it; explain when the selected databases lack a common window.
    if(canPickTime||scope!=='databases')choices.push({intent,label:'Point in time at original location',preset:point,
      ...(!canPickTime&&{disabledReason:'No shared transaction-log window for the selected databases.'})})
    choices.push({intent,label:'Another server',preset:another})
    return choices
  }
  const groups:Group[]=[{label:'Instant database recovery',choices:recovery('instant')},{label:'Restore databases',choices:recovery('restore')},
    {label:'Export',choices:[{intent:'export',label:'Backup file (.bak)',preset:latest},
      {intent:'exportFiles',label:'Database files',preset:latest}]}]
  if(scope==='databases')groups.push({label:'Publish to another server',choices:[{intent:'publish',label:'Publish to another server',preset:another}]})
  return groups
}

export function sqlWizardDefaults(intent:SqlIntent,databases:readonly SourceDatabase[],preset?:SqlRecoveryPreset) {
  const fileExport=intent==='exportFiles'
  const exporting=fileExport||intent==='export'||intent==='exportPublished'
  const range=intent==='exportPublished'?undefined:sqlTimeWindow(databases)
  const initialStage=preset?.destination==='original'&&(intent==='instant'||intent==='restore')?'options' as const:'destination' as const
  return {exporting,fileExport,custom:!exporting&&(preset?.destination==='another'||intent==='publish'),
    pointInTime:!!range&&preset?.time==='pointInTime',range,initialStage}
}

export function sqlRecoverySelection(custom:boolean,host:string,instance:string,pointInTime:boolean,time:number,lsn:string) {
  return {target:custom?{machineName:host.trim(),instanceName:instance.trim()}:{},
    when:pointInTime&&Number.isFinite(time)?{restoreToDate:new Date(time).toISOString(),...(lsn&&{restoreBeforeLsn:lsn})}:{}}
}
