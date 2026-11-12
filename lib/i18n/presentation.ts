// Open Backup UI v1.2.0
import type { MessageValues } from './model'

export type Translator = (source: string, values?: MessageValues) => string

// Only known API enums and application-owned sentinel labels are translated.
// Unknown values are returned verbatim; never use this for resource names or logs.
export function enumLabel(t: Translator, value: string): string {
  switch (value) {
    case 'Stopped': case 'PoweredOff': return t('Stopped')
    case 'Running': case 'PoweredOn': return t('Running')
    case 'Suspended': return t('Suspended')
    case 'Success': return t('Success')
    case 'Succeeded': return t('Succeeded')
    case 'Warning': return t('Warning')
    case 'Failed': return t('Failed')
    case 'None': case 'No status': return t('No status')
    case 'Enabled': return t('Enabled')
    case 'Disabled': return t('Disabled')
    case 'Starting': return t('Starting')
    case 'Stopping': return t('Stopping')
    case 'Idle': return t('Idle')
    case 'Working': return t('Working')
    case 'Pending': return t('Pending')
    case 'Healthy': return t('Healthy')
    case 'Online': return t('Online')
    case 'Offline': return t('Offline')
    case 'Critical': return t('Critical')
    case 'Unavailable': return t('Unavailable')
    case 'Completed': return t('Completed')
    case 'Unknown': return t('Unknown')
    case 'Not reported': return t('Not reported')
    case 'Not applicable': return t('Not applicable')
    case 'Protected': return t('Protected')
    case 'Unprotected': return t('Unprotected')
    case 'Enabled (legacy)': return t('Enabled (legacy)')
    case 'Disabled (legacy)': return t('Disabled (legacy)')
    case 'VirtualMachine': return t('Virtual machine')
    case 'VSphere': return 'VMware vSphere'
    case 'HyperV': return 'Microsoft Hyper-V'
    case 'CloudDirector': return 'VMware Cloud Director'
    case 'Scvmm': case 'SCVMMServer': return 'Microsoft SCVMM'
    case 'CloudDirectorServer': return 'VMware Cloud Director'
    case 'PrismCentral': return 'Nutanix Prism Central'
    case 'ProxmoxNode': return t('Proxmox node')
    case 'VMC': return 'VMware Cloud'
    case 'EntraID': return 'Microsoft Entra ID'
    case 'EntraIdTenant': return t('{provider} tenant', { provider: 'Microsoft Entra ID' })
    case 'WindowsPhysical': return t('Windows physical machine')
    case 'LinuxPhysical': return t('Linux physical machine')
    case 'LinuxPhysicalPpc': return t('Linux PowerPC physical machine')
    case 'UnstructuredData': return t('Unstructured data')
    case 'CustomPlatform': return t('Custom platform')
    case 'ApplicationBackupRepository': return t('Application backup repository')
    case 'Tape': return t('Tape')
    case 'MongoDb': return 'MongoDB'
    case 'AWSEC2': return 'Amazon EC2'
    case 'AzureCompute': return 'Microsoft Azure'
    case 'GCE': return 'Google Compute Engine'
    case 'Directory': return t('Directory')
    case 'File': return t('File')
    case 'FileServerRoot': return t('File server root')
    case 'FileServerShare': return t('File share')
    case 'ObjectStorageRoot': return t('Object storage root')
    case 'Prefix': return t('Prefix')
    case 'Object': return t('Object')
    case 'Container': return t('Container')
    case 'SanFiler': return t('SAN filer')
    case 'SanVolume': return t('SAN volume')
    case 'SanContainer': return t('SAN container')
    case 'vCenterServer': return t('vCenter server')
    case 'Cluster': return t('Cluster')
    case 'Datacenter': return t('Datacenter')
    case 'Host': return t('Host')
    case 'Folder': return t('Folder')
    case 'ResourcePool': return t('Resource pool')
    case 'Datastore': return t('Datastore')
    case 'Template': return t('Template')
    case 'Node': return t('Node')
    case 'Backup': return t('Backup')
    case 'VSphereBackup': return t('VMware backup')
    case 'HyperVBackup': return t('Hyper-V backup')
    case 'VSphereReplica': case 'VSphereReplication': return t('VMware replication')
    case 'HyperVReplication': return t('Hyper-V replication')
    case 'FileBackup': return t('File backup')
    case 'CloudDirectorBackup': return t('{provider} backup', { provider: 'VMware Cloud Director' })
    case 'EntraIDTenantBackup': return t('{provider} backup', { provider: 'Microsoft Entra ID' })
    case 'EntraIDAuditLogBackup': return t('{provider} audit log backup', { provider: 'Microsoft Entra ID' })
    case 'EntraIDTenantBackupCopy': return t('{provider} backup copy', { provider: 'Microsoft Entra ID' })
    case 'CloudBackupAzure': return t('{provider} backup', { provider: 'Microsoft Azure' })
    case 'CloudBackupAWS': return t('{provider} backup', { provider: 'AWS' })
    case 'CloudBackupGoogle': return t('{provider} backup', { provider: 'Google Cloud' })
    case 'ObjectStorageBackup': return t('Object storage backup')
    case 'SureBackupContentScan': return t('SureBackup content scan')
    case 'WinLocal': return t('Local Windows repository')
    case 'LinuxLocal': return t('Local Linux repository')
    case 'LinuxHardened': return t('Hardened Linux repository')
    case 'WasabiCloud': return 'Wasabi'
    case 'WindowsAgentBackup': case 'LinuxAgentBackup': case 'WindowsAgentBackupServerPolicy': case 'WindowsAgentBackupWorkstationPolicy': case 'LinuxAgentBackupServerPolicy': case 'LinuxAgentBackupWorkstationPolicy': return t('Agent backup')
    case 'VSphereBackupCopy': case 'HyperVBackupCopy': case 'FileBackupCopy': case 'LegacyBackupCopy': case 'BackupCopy': return t('Backup copy')
    case 'Replication': return t('Replication')
    case 'Restore points available': return t('Restore points available')
    case 'No restore points': return t('No restore points')
    case 'Count not reported': return t('Count not reported')
    case 'Not failed': return t('Not failed')
    case 'Within threshold': return t('Within threshold')
    case 'Outside threshold': return t('Outside threshold')
    case 'Within RPO': return t('Within RPO')
    case 'Outside RPO': return t('Outside RPO')
    case 'Recovery age unknown': return t('Recovery age unknown')
    default: return value
  }
}
