export interface VBMSchedulePolicy {
  scheduleEnabled: boolean;
  backupWindowEnabled: boolean;
  periodicallyWindowEnabled: boolean;
  type: string;
  dailyType?: string;
  dailyTime?: string;
  retryEnabled: boolean;
  retryNumber: number;
  retryWaitInterval: number;
}

export interface VBMJobLinks {
  self: { href: string };
  copyJob?: { href: string };
  organization?: { href: string };
  backupRepository?: { href: string };
  jobsessions?: { href: string };
  excludedItems?: { href: string };
  selectedItems?: { href: string };
}

export * from './vbm-dashboard';
export interface VBMJob {
  id: string;
  name: string;
  description: string;
  backupType: string;
  schedulePolicy: VBMSchedulePolicy;
  organizationId: string;
  repositoryId: string;
  lastRun: string;
  nextRun: string;
  lastBackup?: string;
  isEnabled: boolean;
  lastStatus: string;
  eTag: number;
  _links: VBMJobLinks;
}

export interface VBMJobsResponse {
  offset: number;
  limit: number;
  _links: {
    self: { href: string };
  };
  results: VBMJob[];
}

export interface VBMJobSessionLinks {
  self: { href: string };
  log: { href: string };
  job: { href: string };
}

export interface VBMJobSessionStatistics {
  processingRateBytesPS: number;
  processingRateItemsPS: number;
  readRateBytesPS: number;
  writeRateBytesPS: number;
  transferredDataBytes: number;
  processedObjects: number;
  bottleneck: string;
}

export interface VBMJobSession {
  id: string;
  jobId: string;
  repositoryId: string;
  mainSessionId: string;
  details: string;
  creationTime: string;
  endTime?: string;
  retryCount: number;
  jobWillBeRetried: boolean;
  progress: number;
  jobType: string;
  status: string;
  statistics: VBMJobSessionStatistics;
  eTag: number;
  _links: VBMJobSessionLinks;
  proxyId?: string;
}

export interface VBMJobSessionsResponse {
  offset: number;
  limit: number;
  _links: {
    self: { href: string };
    next?: { href: string };
  };
  results: VBMJobSession[];
}

export interface VBMOrganization {
  id: string;
  name: string;
  type: string;
  region: string;
  isTeamsOnline: boolean;
  isExchangeOnline: boolean;
  isSharePointOnline: boolean;
  officeName: string;
  _links: {
    self: { href: string };
    jobs?: { href: string };
    groups?: { href: string };
    users?: { href: string };
    sites?: { href: string };
    teams?: { href: string };
    usedRepositories?: { href: string };
  };
}

export interface VBMOrganizationsResponse {
  offset: number;
  limit: number;
  results: VBMOrganization[];
}

export interface VBMUsedRepository {
  repositoryId: string;
  usedSpaceBytes: number;
  localCacheUsedSpaceBytes: number;
  objectStorageUsedSpaceBytes: number;
  isAvailable: boolean;
  protectedObjectsCount: number;
  _links: {
    backupRepository: { href: string };
  };
}

export interface VBMUsedRepositoriesResponse {
  offset: number;
  limit: number;
  results: VBMUsedRepository[];
}

export interface VBMProtectedUser {
  id: string;
  msid: string;
  displayName: string;
  name?: string; // Sometimes APIs use name/displayName interchangeably or one is missing
  accountType: string;
  organizationId: string;
  backedUpOrganizationId: string;
  mailboxes: { id: string; displayName: string; email: string; isArchive: boolean }[];
  oneDrives: { id: string; displayName: string; url: string }[];
  sites: { id: string; displayName: string; url: string }[];
  eTag: number;
}

export interface VBMProtectedGroup {
  id: string;
  msid: string;
  displayName: string;
  organizationId: string;
  backedUpOrganizationId: string;
  mailboxes: { id: string; displayName: string; email: string; isArchive: boolean }[];
  sites: { id: string; displayName: string; url: string }[];
  eTag: number;
}

export interface VBMProtectedSite {
  id: string;
  msid: string;
  displayName: string;
  url: string;
  organizationId: string;
  backedUpOrganizationId: string;
  eTag: number;
}

export interface VBMProtectedTeam {
  id: string;
  msid: string;
  displayName: string;
  description: string;
  organizationId: string;
  backedUpOrganizationId: string;
  eTag: number;
}

export type VBMProtectedItem = (VBMProtectedUser & { type: 'User' }) | (VBMProtectedGroup & { type: 'Group' }) | (VBMProtectedSite & { type: 'Site' }) | (VBMProtectedTeam & { type: 'Team' });

export interface VBMProtectedUsersResponse {
  offset: number;
  limit: number;
  results: VBMProtectedUser[];
}

export interface VBMProtectedGroupsResponse {
  offset: number;
  limit: number;
  results: VBMProtectedGroup[];
}

export interface VBMProtectedSitesResponse {
  offset: number;
  limit: number;
  results: VBMProtectedSite[];
}

export interface VBMProtectedTeamsResponse {
  offset: number;
  limit: number;
  results: VBMProtectedTeam[];
}

export interface VBMRestorePoint {
  id: string;
  isDeleted: boolean;
  repositoryId: string;
  backupTime: string;
  jobId: string;
  organizationId: string;
  isExchange: boolean;
  isSharePoint: boolean;
  isOneDrive: boolean;
  isTeams: boolean;
  isLongTermCopy: boolean;
  isCopy: boolean;
  isRetrieved: boolean;
  eTag: number;
  objectsEtag: number;
  _links: {
    self: { href: string };
    organization: { href: string };
    backupRepository: { href: string };
  };
}

export interface VBMRestorePointsResponse {
  offset: number;
  limit: number;
  results: VBMRestorePoint[];
}

export interface VBMBackupRepository {
  id: string;
  name: string;
  description: string;
  office365SoftDeleteDuration: string;
  adalConfigurationId: string;
  globalRetentionPolicyEnabled: boolean;
  type: string;
  _links: {
    self: { href: string };
  };
}

export interface VBMBackupRepositoriesResponse {
  offset: number;
  limit: number;
  results: VBMBackupRepository[];
}

// ============================================
// VB365 Licensing Types
// ============================================

export interface VB365License {
  licenseID: string;
  email: string;
  status: 'Valid' | 'Expired' | 'Invalid' | string;
  licenseExpires: string;
  gracePeriodExpires: string;
  type: string;
  package: string;
  licensedTo: string;
  totalNumber: number;
  usedNumber: number;
  newNumber: number;
  supportID: string;
}

export interface VB365LicensedUser {
  id: string;
  name: string;
  isBackedUp: boolean;
  lastBackupDate: string | null;
  licenseState: 'Licensed' | 'Unlicensed' | string;
  organizationId: string;
  backedUpOrganizationId: string;
  organizationName: string;
  _links: {
    organization: { href: string };
  };
}

export interface VB365LicensedUsersResponse {
  offset: number;
  limit: number;
  _links: {
    self: { href: string };
  };
  results: VB365LicensedUser[];
}

// ============================================
// VB365 Infrastructure Types
// ============================================

export interface VB365Proxy {
  id: string;
  hostName: string;
  fqdn: string;
  description: string;
  type: 'Local' | 'Remote' | string;
  operatingSystem: string;
  port: number;
  status: 'Online' | 'Offline' | 'Warning' | string;
  maintenanceModeState: 'Enabled' | 'Disabled' | string;
  cpuUsagePercent: number;
  memoryUsagePercent: number;
  version: string;
  serviceAccount: string;
  enableNetworkThrottling: boolean;
  useInternetProxy: boolean;
  internetProxyType?: string;
  role: string[];
  _links: {
    self: { href: string };
    repositories?: { href: string };
  };
}

export interface VB365ProxiesResponse {
  offset: number;
  limit: number;
  _links: {
    self: { href: string };
  };
  results: VB365Proxy[];
}

export interface VB365ObjectStorage {
  id: string;
  accountId: string;
  type: string;
  sizeLimitEnabled: boolean;
  usedSpaceBytes: number;
  enableImmutability: boolean;
  enableImmutabilityGovernanceMode: boolean;
  immutabilityPeriodDays: number;
  s3Folder?: string;
  amazonBucketS3Compatible?: {
    servicePoint: string;
    customRegionId: string;
    name: string;
    trustedServerCertificateThumbprint: string;
  };
  _links: {
    self: { href: string };
    account?: { href: string };
  };
}

export interface VB365Repository {
  id: string;
  name: string;
  description: string;
  path: string;
  capacityBytes: number;
  freeSpaceBytes: number;
  retentionType: string;
  retentionPeriodType: string;
  yearlyRetentionPeriod?: string;
  dailyRetentionPeriod?: string;
  monthlyRetentionPeriod?: string;
  retentionFrequencyType?: string;
  proxyId: string;
  isLongTerm: boolean;
  isOutdated: boolean;
  isOutOfSync: boolean;
  isIndexed: boolean;
  isOutOfOrder: boolean;
  objectStorageEncryptionEnabled: boolean;
  encryptionKeyId?: string;
  objectStorage?: VB365ObjectStorage;
  _links: {
    self: { href: string };
    proxy?: { href: string };
  };
}

export interface VB365RepositoriesResponse {
  offset: number;
  limit: number;
  _links: {
    self: { href: string };
  };
  results: VB365Repository[];
  setId?: string;
}


