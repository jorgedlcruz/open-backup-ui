// Open Backup UI v1.0.2
import type {RecoveryObject} from '@/lib/restore-points/recovery-picker'
import {useRecoveryPresentation} from '../restore-points/use-presentation'

export function VmIdentity({object}:{object:RecoveryObject}){
  const {t}=useRecoveryPresentation()
  if(!object.distinguishingLocation)return null
  const fullId=t('Backup object ID')+' · '+object.objectId
  return <small title={fullId}>{object.distinguishingLocation}<span className="sr-only"> · {fullId}</span></small>
}
