// Veeam Backup & Replication API Types

// Job Types
export type JobType =
  | 'Unknown'
  | 'VSphereBackup'
  | 'HyperVBackup'
  | 'VSphereReplica'
  | 'CloudDirectorBackup'
  | 'EntraIDTenantBackup'
  | 'EntraIDAuditLogBackup'
  | 'FileBackupCopy'
  | 'LegacyBackupCopy'
  | 'BackupCopy'
  | 'WindowsAgentBackup'
  | 'LinuxAgentBackup'
  | 'FileBackup'
  | 'ObjectStorageBackup'
  | 'EntraIDTenantBackupCopy'
  | 'SureBackupContentScan'
  | 'CloudBackupAzure'
  | 'CloudBackupAWS'
  | 'CloudBackupGoogle'
  | 'WindowsAgentBackupWorkstationPolicy'
  | 'LinuxAgentBackupWorkstationPolicy'
  | 'WindowsAgentBackupServerPolicy'
  | 'LinuxAgentBackupServerPolicy';

// Server Info Type
export interface VeeamServerInfo {
  platform: string;
  vbrId: string;
  name: string;
  buildVersion: string;
  patches: string[];
  databaseVendor: string;
  sqlServerVersion: string;
  databaseSchemaVersion: string;
}

// Base Job Model (matching API spec)
export interface SessionProgress {
  bottleneck?: string;
  duration?: string;
  processingRate?: string;
  processedSize?: number;
  readSize?: number;
  transferredSize?: number;
  progressPercent?: number;
}

// Base Job Model (matching API spec)
export interface VeeamBackupJob {
  id: string;
  name: string;
  type: JobType;
  isDisabled?: boolean; // API returns 'status' as string, but we might want to map it
  status: string; // "Disabled", "Inactive", "Stopped", "Running"
  description?: string;
  // Extended fields for UI
  scheduleEnabled?: boolean;
  scheduleConfigured?: boolean;
  nextRun?: string;
  nextRunPolicy?: string;
  lastRun?: string;
  lastResult?: SessionResult;
  isRunning?: boolean;

  // New fields from /jobs/states
  workload?: string;
  backupCopyMode?: string;
  repositoryId?: string;
  repositoryName?: string;
  objectsCount?: number;
  sessionId?: string;
  highPriority?: boolean;
  progressPercent?: number;
  sessionProgress?: SessionProgress;
  isStorageSnapshot?: boolean;
}

// Session Types
export type SessionType =
  | 'BackupJob'
  | 'BackupCopyJob'
  | 'ReplicaJob'
  | 'RestoreVm'
  | 'FileLevelRestore'
  | 'AgentBackup'
  | 'AgentPolicy'
  | string; // Allow other session types

export type SessionState =
  | 'Stopped'
  | 'Starting'
  | 'Stopping'
  | 'Working'
  | 'Pausing'
  | 'Resuming'
  | 'WaitingTape'
  | 'Idle'
  | 'Postprocessing'
  | 'WaitingRepository';

export type SessionResult =
  | 'Success'
  | 'Warning'
  | 'Failed'
  | 'None';

export interface SessionResultModel {
  result: SessionResult;
  message?: string;
}

export interface VeeamSession {
  id: string;
  name: string;
  jobId: string;
  sessionType: SessionType;
  creationTime: string;
  endTime?: string;
  state: SessionState;
  progressPercent?: number;
  result?: SessionResultModel;
  resourceId?: string;
  resourceReference?: string;
  parentSessionId?: string;
  usn: number;
  platformName?: string;
  platformId?: string;
  initiatedBy?: string;
}

// API Response Types
export interface PaginationResult {
  total: number;
  count: number;
  offset: number;
}

export interface JobsResult {
  data: VeeamBackupJob[];
  pagination: PaginationResult;
}

export interface SessionsResult {
  data: VeeamSession[];
  pagination: PaginationResult;
}

export interface VeeamApiResponse<T> {
  data: T[];
  pagination?: PaginationResult;
}

export interface VeeamAuthToken {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface VeeamApiError {
  message: string;
  code?: string;
  details?: string;
}

// Managed Server Types
export interface ManagedServerComponent {
  componentName: string;
  port: number;
}

export interface SshSettings {
  components: ManagedServerComponent[];
  sshTimeOutMs?: number;
  portRangeStart: number;
  portRangeEnd: number;
  serverSide: boolean;
}

export interface NetworkSettings {
  components: ManagedServerComponent[];
  portRangeStart: number;
  portRangeEnd: number;
  serverSide: boolean;
}

export interface ManagedServer {
  id: string;
  name: string;
  description: string;
  type: string;
  status: string;
  credentialsId?: string;
  credentialsStorageType?: string;
  sshSettings?: SshSettings;
  networkSettings?: NetworkSettings;
  isBackupServer?: boolean;
  isDefaultMountServer?: boolean;
  isVBRLinuxAppliance?: boolean;
  viHostType?: string;
  port?: number;
}

export interface ManagedServersResult {
  data: ManagedServer[];
  pagination: PaginationResult;
}

export interface TransferRateDataPoint {
  hour: string;
  rate: number;
  timestamp: Date;
  sessionCount: number;
}

// License Types
// License Types
export interface LicenseObject {
  type: string;
  count: number;
  multiplier: number;
  usedInstancesNumber: number;
}

export interface LicenseWorkload {
  platformType: string;
  name: string;
  displayName: string;
  hostName: string;
  usedInstancesNumber: number;
  type: string;
  instanceId: string;
  canBeRevoked: boolean;
}

export interface LicenseInstanceSummary {
  package: string;
  licensedInstancesNumber: number;
  usedInstancesNumber: number;
  newInstancesNumber: number;
  rentalInstancesNumber: number;
  objects: LicenseObject[];
  workload: LicenseWorkload[];
}

export interface LicenseModel {
  status: string;
  type: string;
  edition: string;
  cloudConnect: string;
  expirationDate: string;
  licensedTo: string;
  instanceLicenseSummary: LicenseInstanceSummary;
  supportId: string;
  autoUpdateEnabled: boolean;
  freeAgentInstanceConsumptionEnabled: boolean;
  IsMultiSection: boolean;
  proactiveSupportEnabled: boolean;
}

export interface LicenseReportProduct {
  productVersion: string;
  edition: string;
  package: string;
  installationId: string;
  data: Array<{
    instances: {
      supportId: string;
      licenseId: string;
      licenseType: string;
      counters: Array<{
        counterType: string;
        multiplier: string;
        instancesInGrace: string;
        numberOfObjects: number;
        numberOfNewObjects: number;
        numberOfRentalObjects: number;
        numberOfRemovedObjects: number;
        consumedInstances: string;
        newInstances: string;
        rentalInstances: string;
        removedInstances: string;
        reasonForRemoval: string;
      }>;
    };
  }>;
}

export interface LicenseReport {
  products: LicenseReportProduct[];
}

// Repository Types
export interface RepositoryModel {
  id: string;
  name: string;
  description: string;
  type: string;
  capacity?: number;
  freeSpace?: number;
}

export interface RepositoriesResult {
  data: RepositoryModel[];
  pagination: PaginationResult;
}

// Malware Types
export interface MalwareEventModel {
  id: string;
  objectId: string;
  objectName: string;
  detectionTime: string;
  engine: string;
  message: string;
  status: string;
}

export interface MalwareEventsResult {
  data: MalwareEventModel[];
  pagination: PaginationResult;
}

// Security Types
export interface SecurityBestPracticeItem {
  id: string;
  status: 'Ok' | 'Warning' | 'Violation' | 'Suppressed' | 'UnableToCheck' | 'OK'; // API returns 'OK' uppercase based on example
  bestPractice: string;
  note: string;
}

export interface SecurityBestPracticesResult {
  items: SecurityBestPracticeItem[];
}
export interface TaskProgress {
  bottleneck: string;
  duration: string;
  processingRate: string;
  processedSize: number;
  readSize: number;
  transferredSize: number;
  progressPercent: number;
}

export interface TaskResultModel {
  result: SessionResult;
  message: string;
  isCanceled: boolean;
}

export interface VeeamTaskSession {
  id: string;
  name: string; // VM Name
  type: string;
  sessionType: string;
  state: string;
  algorithm?: string;
  restorePointId?: string;
  repositoryId?: string;
  creationTime: string;
  endTime?: string;
  progress: TaskProgress;
  result: TaskResultModel;
  usn?: number;
}

export interface TaskSessionsResult {
  data: VeeamTaskSession[];
  pagination: PaginationResult;
}

// ============================================
// Backup Types
// ============================================

export interface VeeamBackup {
  id: string;
  name: string;
  creationTime: string;
  platformId?: string;
  jobId?: string;
  policyId?: string;
  // Add other fields as needed
}

export interface VeeamBackupFile {
  id: string;
  name: string;
  backupId: string;
  creationTime: string;
  dataSize: number;
  backupSize: number;
  dedupRatio: number;
  compressRatio: number;
  isGfs?: boolean;
  objectId?: string;
}

export interface VeeamRestorePoint {
  id: string;
  name: string;
  creationTime: string;
  algorithm: string;
  pointType: string;
  hierarchyObjRef: string;
  backupId: string;
  platformId: string;
  iamUuid?: string;
  options?: unknown;
  hasIndex?: boolean;
  isGfs?: boolean;

  // These might not be directly on RestorePoint payload from VBR, 
  // but let's check what we get. VBR Restore Points usually don't have separate sizes per point 
  // same way files do, unless we look at the file. 
  // BUT the user wants to see sizes. 
  // The RestorePoint object in VBR API v1.x usually has limited info.
  // 
  // Wait, if the user wants sizes, maybe querying BackupFiles WAS the right way if we could filter them?
  // But BackupFiles are "per job run", so if it's a per-vm backup chain, then 1 file = 1 vm.
  // If it's a single-file backup chain (per job), then 1 file = multiple VMs.
  //
  // If we can't get sizes from RestorePoints endpoint, we might be stuck.
  // Let's stick to adding the type for now and see what we get. I'll add optional size fields just in case.
  // Enriched fields for UI
  jobName?: string;
  repositoryName?: string;
  dataSize?: number;
  backupSize?: number;
  dedupRatio?: number;
  compressRatio?: number;
  fileName?: string;
}

export interface BackupsResult {
  data: VeeamBackup[];
  pagination: PaginationResult;
}

export interface BackupFilesResult {
  data: VeeamBackupFile[];
  pagination: PaginationResult;
}

export interface VeeamBackupObject {
  id: string;
  name: string;
  type: string;
  platformName: string;
  platformId: string;
  jobId?: string; // Sometimes provided in context
  viType?: string;
  objectId?: string;
  path?: string;
  restorePointsCount?: number;
  lastRunFailed?: boolean;
}

export interface BackupObjectsResult {
  data: VeeamBackupObject[];
  pagination: PaginationResult;
}

export interface VeeamProtectedWorkload extends VeeamBackupObject {
  jobName?: string;
  repositoryName?: string;
  repositoryId?: string;
  backupId?: string;
}

// ============================================
// Veeam Recovery Orchestrator (VRO) Types
// ============================================

export type PlanType =
  | 'Replica'
  | 'CdpReplica'
  | 'Storage'
  | 'Restore'
  | 'Unknown';

export type PlanState =
  | 'Disabled'
  | 'Ready'
  | 'Running'
  | 'FailoverComplete'
  | 'FailbackComplete'
  | 'Halted'
  | 'DryRun';

export type PlanMode =
  | 'Enabled'
  | 'Disabled';

export type PlanResult =
  | 'Success'
  | 'Warning'
  | 'Error'
  | 'MalwareIssue'
  | 'Complete'
  | 'Undefined';

export interface VRORecoveryPlan {
  id: string;
  name: string;
  planType: PlanType;
  state: PlanState;
  stateName: string;
  planMode: PlanMode;
  description?: string;
  resultName?: string;
  lastTestResult?: PlanResult;
  lastTestTime?: string;
  lastCheckResult?: PlanResult;
  lastCheckTime?: string;
  nearestFailoverScheduleTime?: string;
  nearestTestScheduleTime?: string;
  progress?: number;
  isRunning?: boolean;
  isStableState?: boolean;
  currentRunResult?: PlanResult;
  contactName?: string;
  contactEmail?: string;
}

export interface PlansResult {
  data: VRORecoveryPlan[];
  total: number;
}

// ============================================
// Protection Group Types
// ============================================

export interface VeeamProtectionGroup {
  id: string;
  name: string;
  description: string;
  type: string; // "ManuallyAdded", "ADObjects", etc.
  isDisabled: boolean;
  options?: Record<string, unknown>; // Simplify for now, can be typed strictly if needed
}

export interface ProtectionGroupsResult {
  data: VeeamProtectionGroup[];
  pagination: PaginationResult;
}

export interface VeeamDiscoveredEntity {
  id: string;
  name: string;
  type: string; // "Computer"
  isTrusted: boolean;
  parentId?: string;
  protectionGroupId: string;
  state?: string; // "Online"
  agentStatus?: string; // "Installed"
  driverStatus?: string; // "NotInstalled"
  operatingSystem?: string;
  operatingSystemPlatform?: string; // "X64"
  agentVersion?: string;
  rebootRequired?: boolean;
  ipAddresses?: string[];
  lastConnected?: string;
  operatingSystemVersion?: string;
  operatingSystemUpdateVersion?: number;
  objectId?: string;
  biosUuid?: string;
  plugins?: Array<{ type: string; status: string }>;
}

export interface DiscoveredEntitiesResult {
  data: VeeamDiscoveredEntity[];
  pagination: PaginationResult;
}

// ============================================
// Unstructured Data Types
// ============================================

export interface VeeamUnstructuredServer {
  id: string;
  name: string;
  description: string;
  type: string; // "SMBShare", "NFSShare", "FileServer"
  path?: string;
  hostId?: string;
  accessCredentialsRequired?: boolean;
  accessCredentialsId?: string;
  processing?: {
    cacheRepositoryId?: string;
    backupIOControlLevel?: string;
  };
  // Enriched fields
  credentialsName?: string;
  credentialsDescription?: string;
  credentialsUserName?: string;
  credentialsCreationTime?: string;
  repositoryName?: string;
  repositoryDescription?: string;
}

export interface UnstructuredServersResult {
  data: VeeamUnstructuredServer[];
  pagination: PaginationResult;
}

export interface VeeamCredential {
  id: string;
  uniqueId: string;
  type: string;
  username: string;
  description: string;
  creationTime: string;
}

// Extended Repository Model for details
export interface VeeamRepositoryDetailed extends RepositoryModel {
  hostId?: string;
  path?: string;
}

// ============================================
// Virtual Infrastructure Inventory Types
// ============================================

export interface VeeamInventoryItem {
  type: string; // 'VirtualMachine' | 'Host' | 'Datacenter' | 'Cluster' | 'vCenterServer' | 'ResourcePool'
  hostName: string;
  name: string;
  objectId: string;
  urn: string;
  platform: string;
  size?: string; // string format like "4.3 TB"
  isEnabled?: boolean;
  metadata?: Array<{ field: string; data: string }>;
}

export interface InventoryResult {
  data: VeeamInventoryItem[];
  pagination: PaginationResult;
}

export interface InventoryFilter {
  filter?: {
    type?: string;
    operation?: string;
    items?: Array<unknown>;
  };
  sorting?: {
    property: string;
    direction: 'ascending' | 'descending';
  };
}


// ============================================
// Backup Infrastructure Types
// ============================================

export interface VeeamProxyState {
  id: string;
  name: string;
  description: string;
  type: string; // "GeneralPurposeProxy", "ViProxy"
  hostId?: string;
  hostName?: string;
  isDisabled: boolean;
  isOnline: boolean;
  isOutOfDate: boolean;
}

export interface ProxyStatesResult {
  data: VeeamProxyState[];
  pagination: PaginationResult;
}

export interface VeeamProxy {
  id: string;
  name: string;
  description: string;
  type: string;
  server: {
    hostId: string;
    hostName: string;
    maxTaskCount: number;
    transportMode?: string;
    failoverToNetwork?: boolean;
    hostToProxyEncryption?: boolean;
    connectedDatastores?: {
      autoSelectEnabled: boolean;
    };
  };
  // Enriched fields
  osType?: string; // from managed server
  isOnline?: boolean; // from proxy state
  isDisabled?: boolean; // from proxy state
  isOutOfDate?: boolean; // from proxy state
  isVBRLinuxAppliance?: boolean; // from managed server
}

export interface ProxiesResult {
  data: VeeamProxy[];
  pagination: PaginationResult;
}

export interface VeeamRepository {
  id: string;
  name: string;
  description: string;
  type: string; // "WinLocal", "Nfs", "WasabiCloud", "LinuxHardened", etc.
  hostId?: string;
  repository?: {
    path?: string;
    taskLimitEnabled?: boolean;
    maxTaskCount?: number;
    advancedSettings?: {
      perVmBackup?: boolean;
    };
  };
  share?: {
    sharePath?: string;
  };
  bucket?: {
    bucketName?: string;
    folderName?: string;
    immutability?: {
      isEnabled: boolean;
      daysCount: number;
    };
  };
  mountServer?: {
    mountServerSettingsType: string;
  };
}

export interface BackupRepositoriesResult {
  data: VeeamRepository[];
  pagination: PaginationResult;
}

export interface VeeamRepositoryState {
  id: string;
  name: string;
  description: string;
  type: string;
  hostName: string;
  path: string;
  capacityGB: number;
  freeGB: number;
  usedSpaceGB: number;
  isOnline: boolean;
  isOutOfDate: boolean;
}

export interface RepositoryStatesResult {
  data: VeeamRepositoryState[];
  pagination: PaginationResult;
}

export interface VeeamRepositoryEnriched extends VeeamRepositoryState {
  // Config fields from VeeamRepository
  maxTaskCount?: number;
  taskLimitEnabled?: boolean;
  immutabilityEnabled?: boolean;
  immutabilityDays?: number;
  perVmBackup?: boolean;
}
