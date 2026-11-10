// Open Backup UI v1.2.0
import type {RecoveryObject} from '@/lib/restore-points/recovery-picker'
import {useRecoveryPresentation} from '../restore-points/use-presentation'

export function VmIdentity({object,showPath=false}:{object:RecoveryObject;showPath?:boolean}){
  const {t}=useRecoveryPresentation()
  const location=showPath&&object.displayPath?object.displayPath:object.distinguishingLocation
  if(!location)return null
  const fullId=t('Backup object ID')+' · '+object.objectId
  const suffix=object.distinguishingLocation?.split(' · ').at(-1)
  const ambiguous=showPath&&object.displayPath&&suffix&&suffix.length>=8&&object.objectId.endsWith(suffix)
  return <small title={object.distinguishingLocation?fullId:location}>{location}{ambiguous?' · '+suffix:''}
    {object.distinguishingLocation&&<span className="sr-only"> · {fullId}</span>}</small>
}
