// Open Backup UI v1.0.2
import type {SqlIntent,SqlStep} from './sql-actions'

export function requiredSqlChecks(intent:SqlIntent,settings:{pointInTime?:boolean}):SqlStep[] {
  if(intent==='exportPublished')return ['stagingServerSqlCredentials','stagingServerGuestCredentials','exportTargetWindowsServer','exportTargetPath']
  if(intent==='exportFiles') {
    const selectedTime:SqlStep[]=settings.pointInTime?['stagingServerSqlCredentials','stagingServerGuestCredentials','adminShareAccess','targetInstance']:[]
    return [...selectedTime,'exportPointInTime','mountAccess',...(settings.pointInTime?['windowsLogBackups' as const]:[]),
      'exportTargetWindowsServer','exportTargetPath',...(settings.pointInTime?['stagingServerFreeSpaceForExport' as const]:[])]
  }
  if(intent==='export')return ['stagingServerSqlCredentials','stagingServerGuestCredentials','adminShareAccess','mountAccess','targetInstance',
    'windowsLogBackups','exportPointInTime','exportTargetWindowsServer','exportTargetPath',...(settings.pointInTime?['stagingServerFreeSpaceForExport' as const]:[])]
  const common:SqlStep[]=['sqlCredentials','guestCredentials','adminShareAccess','mountAccess','windowsLogBackups','targetInstance']
  if(intent==='publish')return [...common,'sqlDatabasesDoNotExist']
  if(intent==='instant')return [...common,'standByRestoreMode','sqlDatabasesDoNotExist','files']
  return [...common,'alwaysOnAndUpdatePrimaryNode','sqlDatabasesDoNotExist','files','filesOnReplicas','freeSpace','standByRestoreMode']
}
