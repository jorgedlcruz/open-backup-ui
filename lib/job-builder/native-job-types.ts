// Open Backup UI v1.3.0
export const nativeJobNames = {
  RedHatOpenStackBackupJob: 'Red Hat OpenStack backup',
  VirtuozzoBackupJob: 'Virtuozzo backup',
  UnixAgentBackup: 'UNIX agent backup',
  UnixAgentBackupServerPolicy: 'UNIX server backup policy',
  MacAgentBackupServerPolicy: 'Mac server backup policy',
  MacAgentBackupWorkstationPolicy: 'Mac workstation backup policy',
  VSphereCdpPolicy: 'VMware vSphere CDP policy',
  WindowsUniversalCdpPolicy: 'Windows Universal CDP policy',
  LinuxUniversalCdpPolicy: 'Linux Universal CDP policy',
  StorageCopy: 'Storage copy',
} as const

export type NativeJobType = keyof typeof nativeJobNames
export function supportedJob(value: unknown): value is NativeJobType {
  return typeof value === 'string' && Object.hasOwn(nativeJobNames, value)
}
