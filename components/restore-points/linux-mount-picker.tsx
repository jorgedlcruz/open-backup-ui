// Open Backup UI v1.0.2
import {useId} from 'react'
import type {LinuxMountType,RestoreOptions} from '@/lib/restore-points/workflow'
import {useRecoveryPresentation} from './use-presentation'
import styles from './workflow.module.css'

export type LinuxMountChoice={key:string; type:LinuxMountType; id:string; name:string}
export const mountRoleLabel:Record<LinuxMountType,string>={HelperHost:'Helper host',OriginalHost:'Original host',MountServer:'Dedicated mount server'}
const roles:LinuxMountType[]=['HelperHost','OriginalHost','MountServer']

export function linuxMountChoices(options:RestoreOptions):LinuxMountChoice[] {
  const {linuxMount}=options
  const helpers=(linuxMount?.helperHosts||[]).map(host=>({type:'HelperHost' as const,...host,key:'helper/'+host.id}))
  const servers=options.mountServers.filter(host=>host.type?.toLowerCase()==='linux').map(host=>({id:host.id,name:host.name,key:'mount/'+host.id,type:'MountServer' as const}))
  const original=linuxMount?.originalHost
  return [...helpers,...(original?.available?[{type:'OriginalHost' as const,id:options.point.id,name:original.name||options.point.name||options.point.id,key:'original'}]:[]),...servers]
}

export function initialLinuxMount(choices:LinuxMountChoice[],options:RestoreOptions){
  const helpers=choices.filter(choice=>choice.type==='HelperHost')
  const preferred=helpers.length?helpers:choices.filter(choice=>choice.type==='MountServer')
  const recommended=options.linuxMount?.recommended
  return preferred.find(choice=>choice.type===recommended?.type&&choice.id===recommended.id)?.key||
    (preferred.length===1?preferred[0].key:'')
}

export function LinuxMountPicker({options,choices,value,credentialId,onChange,onCredential}:{
  options:RestoreOptions;choices:LinuxMountChoice[];value:string;credentialId:string;onChange:(key:string)=>void;onCredential:(id:string)=>void
}){
  const {t}=useRecoveryPresentation(),hintId=useId()
  const selected=choices.find(choice=>choice.key===value)
  const hasHelpers=choices.some(choice=>choice.type==='HelperHost'),original=selected?.type==='OriginalHost'
  const hint=!choices.length?'VBR did not report a Linux mount host for this restore point.':original?'The original host must be online and reachable by VBR.':
    selected?.type==='HelperHost'||!selected&&hasHelpers?'A helper host can mount the backup while the original host is offline.':undefined
  return <>
    <div className={styles.field}><label>{t('Mount server')}
      <select required disabled={!choices.length} value={value} onChange={event=>onChange(event.target.value)} aria-describedby={hint?hintId:undefined}>
        <option disabled value="">{t(hasHelpers?'Select a helper host':'Select a mount server')}</option>
        {roles.map(role=>{
          const members=choices.filter(choice=>choice.type===role)
          return members.length>0&&<optgroup label={t(mountRoleLabel[role])} key={role}>
            {members.map(choice=><option key={choice.key} value={choice.key}>{choice.name}</option>)}
          </optgroup>
        })}
      </select></label>
      {hint&&<small id={hintId} className={styles.mountHint}>{t(hint)}</small>}
    </div>
    {original&&!!options.linuxMount?.credentials.length&&<label className={styles.field}>{t('Guest credentials')}
      <select value={credentialId} onChange={event=>onCredential(event.target.value)}>
        <option value="">{t('Use job credentials')}</option>
        {options.linuxMount.credentials.map(credential=><option key={credential.id} value={credential.id}>{credential.name}</option>)}
      </select>
    </label>}
  </>
}
