'use client'
// Open Backup UI v1.2.0

import {ChevronDown, DatabaseBackup, HardDriveDownload, MonitorPlay, Upload} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {sqlActionGroups,type SqlActionScope,type SqlRecoveryPreset} from '@/lib/restore-points/sql-action-presets'
import type {SqlIntent,SqlItem} from './sql-explorer'
import {useRecoveryPresentation} from './use-presentation'
import styles from './sql-browse-workspace.module.css'

export function SqlRecoveryActions({databases,scopeKind,scopeDescription,onAction,disabled=false}:{
  databases:SqlItem[];scopeKind:SqlActionScope;scopeDescription:string;onAction:(intent:SqlIntent,preset:SqlRecoveryPreset)=>void;disabled?:boolean
}) {
  const {t}=useRecoveryPresentation(),groups=sqlActionGroups(scopeKind,databases)
  if(!groups.length)return null
  return <div role="group" aria-label={t('Recovery actions')} aria-describedby={scopeDescription} className={styles.recoveryActions}>
    {groups.map(({label,choices})=>{
      const first=choices[0],Icon=first.intent==='instant'?MonitorPlay:first.intent==='restore'?DatabaseBackup:first.intent==='publish'?Upload:HardDriveDownload
      if(choices.length===1)return <Button key={label} type="button" size="sm" variant="outline" disabled={disabled}
        onClick={()=>onAction(first.intent,first.preset)}><Icon size={15}/>{t(label)}</Button>
      return <DropdownMenu key={label}><DropdownMenuTrigger asChild><Button type="button" size="sm" variant="outline" disabled={disabled}>
        <Icon size={15}/>{t(label)}<ChevronDown size={13}/></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" aria-label={t(label)}>{choices.map(({intent,label:caption,preset,disabledReason})=>
          <DropdownMenuItem key={caption} disabled={!!disabledReason} onSelect={()=>onAction(intent,preset)}>
            <span className="flex max-w-72 flex-col gap-0.5"><span>{t(caption)}</span>
              {disabledReason&&<small className="whitespace-normal text-muted-foreground">{t(disabledReason)}</small>}</span>
          </DropdownMenuItem>)}</DropdownMenuContent>
      </DropdownMenu>
    })}
  </div>
}
