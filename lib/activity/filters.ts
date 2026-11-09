// Open Backup UI v1.0.2
import { z } from 'zod'

// VBR 1.3-rev2 ESessionType. The group is an app filter; each value sent to VBR is an exact sessionType.
export const sessionGroups: Record<string, string[]> = {
  Backup: [
    'BackupJob', 'BackupCopyJob', 'BackupCopyJobParent', 'ConfigurationBackup', 'FileServerSave',
    'SqlLogBackup', 'OracleLogBackup', 'PostgreSqlLogBackup', 'IrisBackup', 'AgentBackup', 'EndpointBackup',
    'AgentOperationBackupNow', 'AgentOperationActiveFull', 'PlatformBackupJob', 'PlatformSnapshotJob',
    'PlatformSnapshotCopyJob', 'UnstructuredDataBackupCopy', 'CopyBackup', 'PerVmCopyBackup',
  ],
  Recovery: [
    'RestoreVm', 'InstantRecovery', 'FirstClassDiskInstantRestore', 'QuickMigration', 'FirstClassDiskQuickMigration',
    'FileLevelRestore', 'LinuxFileLevelRestore', 'PublishBackupContentViaMount', 'PublishBackupContentViaNfs',
    'CloudDirectorVmRestore', 'CloudDirectorVAppRestore', 'EntraIdRestore', 'EntraIdRestoreFromCopy',
    'NasRestore', 'AzureInstantRecovery', 'AzureInstantRecoveryMigration', 'AzureInstantRecoverySwitchover',
    'AzureInstantRecoveryStart', 'AzureInstantRecoveryStop', 'AzureInstantRecoveryMigrationUndo', 'AzureInstantRecoveryMount',
    'FileInstantRecovery', 'FileInstantRecoveryMigration', 'ApplicationLevelRestore', 'AdForestRestore',
    'RestoreRecoveryApplianceVolumes', 'RestoreAgentVolumes', 'EndpointRestore', 'InstantDiskRecovery', 'DiskRestore',
    'UnstructuredDataBrowse', 'UnstructuredDownloadMeta',
  ],
  Replication: [
    'ReplicaJob', 'Failover', 'PlannedFailover', 'PermanentFailover', 'UndoFailover', 'Failback',
    'CommitFailback', 'UndoFailback', 'SwitchReplicaToProduction', 'FailoverPlan', 'FailoverPlanTask',
  ],
  Security: ['MalwareDetection', 'SecurityComplianceAnalyzer', 'SureBackup', 'FileBackupHealthCheck', 'SureBackupContentScan', 'EncryptionAnalysis'],
  Infrastructure: [
    'Infrastructure', 'Automation', 'RepositoryMaintenance', 'RepositoryEvacuate', 'InfrastructureItemDeletion',
    'AzureApplianceDeploy', 'ConfigurationResynchronize', 'LogsExport', 'TestCredentials', 'VolumesDiscover',
    'DeleteBackup', 'BackgroundOperation', 'AgentDiscovery', 'AgentPolicy', 'AgentOperationPurgeCache',
    'ApplianceUpdatesInstall', 'EntraIdRescanRepository', 'HostComponentsUpdate', 'ArchiveBackup', 'ArchiveRehydration',
    'ArchiveSync', 'ArchiveCopy', 'ArchiveFreezing', 'RetrieveBackup', 'ArchiveTierDownload', 'DirectBackupSync',
    'CheckpointRemoval', 'Retention', 'PlatformServiceJob', 'AgentManagement', 'VeeamUpdaterSettingsSync',
    'StorageDiscovery', 'StorageMonitoring', 'AgentsRecoveryAppliancesManagement', 'EpAgentOperationStopBackup',
    'BackupCacheSync', 'PerVmMoveBackup', 'FileBackupArchiveRetrievalProlonging', 'HaSwitchover', 'IndexCollection', 'HaClusterEdit',
  ],
}
export const sessionTypes = Object.values(sessionGroups).flat().sort()
export const sessionStates = ['Stopped', 'Starting', 'Stopping', 'Working', 'Pausing', 'Resuming', 'WaitingTape', 'Idle', 'Postprocessing', 'WaitingRepository', 'WaitingSlot', 'ActionRequired']
export const sessionResults = ['Success', 'Warning', 'Failed', 'None']
export const sessionPlatforms = ['VMware', 'HyperV', 'CloudDirector', 'WindowsPhysical', 'LinuxPhysical', 'Tape', 'CustomPlatform', 'EntraID', 'UnstructuredData', 'MongoDb', 'Iris', 'AWSEC2', 'AzureCompute', 'GCE', 'Nutanix', 'Proxmox', 'LinuxPhysicalPpc', 'ApplicationBackupRepository', 'Test']
export const dateWindows: Record<string, number> = {'24h': 1, '7d': 7, '30d': 30}

const optionalChoice = (choices: string[]) => z.string().refine(value => !value || choices.includes(value)).default('')
export const activityQuerySchema = z.object({
  skip: z.coerce.number().int().min(0).max(2147483647).default(0),
  before: z.iso.datetime({offset: true}).optional(),
  name: z.string().trim().max(200).default(''),
  state: optionalChoice(sessionStates),
  group: optionalChoice(Object.keys(sessionGroups)),
  types: z.array(z.string().refine(value => sessionTypes.includes(value))).max(sessionTypes.length).default([]),
  results: z.array(z.string().refine(value => sessionResults.includes(value))).max(sessionResults.length).default([]),
  platform: optionalChoice(sessionPlatforms),
  window: optionalChoice(Object.keys(dateWindows)),
}).refine(query => !query.group || query.types.every(type => sessionGroups[query.group].includes(type)))

export type ActivityQuery = z.infer<typeof activityQuerySchema>
export const defaultFilters: ActivityQuery = activityQuerySchema.parse({})

export function buildActivityParams(query: ActivityQuery) {
  const params = new URLSearchParams()
  if (query.skip) params.set('skip', String(query.skip))
  if (query.before) params.set('before', query.before)
  for (const key of ['name', 'state', 'group', 'platform', 'window'] as const) if (query[key]) params.set(key, query[key])
  for (const type of query.types) params.append('type', type)
  for (const result of query.results) params.append('result', result)
  return params
}
