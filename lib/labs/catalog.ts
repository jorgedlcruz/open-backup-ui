// Open Backup UI v1.0.2
export type Field = {
  key: string; label: string; type: 'text' | 'number' | 'date'
  unit?: 'bytes' | 'percent' | 'seconds' | 'gb' | 'days' | 'gb-day'
  identityKey?: string
}
const field = (key: string, label: string, type: Field['type'] = 'text', unit?: Field['unit'], identityKey?: string): Field => ({ key, label, type, unit, identityKey })
const name = (label: string, identityKey = 'id') => field('name', label, 'text', undefined, identityKey)
const id = field('id', 'ID'), time = field('time', 'Time', 'date')
const repository = [field('repository', 'Repository', 'text', undefined, 'repositoryId'), field('repositoryId', 'Repository ID')]
const num = (key: string, label: string, unit?: Field['unit']) => field(key, label, 'number', unit)
const copies = [name('Object name'), id, field('platform', 'Platform'), field('type', 'Object type'), field('status', 'Recovery coverage'), field('run', 'Last run'), field('repository', 'Repository'), field('job', 'Job'), field('size', 'Protected size', 'number', 'bytes'), field('points', 'Restore points', 'number'), field('copies', 'Backup copies', 'number')]
export const fieldCatalog = {
  protected: copies, objects: copies,
  history: [name('Session name'), id, field('jobName', 'Job name', 'text', undefined, 'jobId'), field('jobId', 'Job ID'), field('jobNameSource', 'Job name evidence'), field('type', 'Session type'), field('status', 'Outcome / state'), time, field('end', 'Ended', 'date'), field('duration', 'Duration', 'number', 'seconds'), field('progress', 'Progress', 'number', 'percent')],
  jobs: [name('Job name'), id, field('type', 'Job type'), field('status', 'Current state'), field('result', 'Last result'), field('repository', 'Repository'), field('objects', 'Objects', 'number'), field('progress', 'Progress', 'number', 'percent'), time, field('next', 'Next run', 'date')],
  repositories: [name('Repository name'), id, field('type', 'Repository type'), field('status', 'Capacity state'), field('capacity', 'Capacity', 'number', 'gb'), field('free', 'Free space', 'number', 'gb'), field('used', 'Used space', 'number', 'gb'), field('utilization', 'Utilization', 'number', 'percent')],
  malware: [name('Workload name', 'objectId'), id, field('objectId', 'Object ID'), field('severity', 'Severity'), field('status', 'Resolution state'), field('type', 'Detection type'), field('engine', 'Engine'), field('source', 'Detection source'), time, field('details', 'Details')],
  security: [name('Best practice'), id, field('status', 'Status')],
  forecast: [name('Repository name', 'repositoryId'), id, ...repository, field('status', 'Sample type'), time, num('recorded', 'Recorded footprint', 'bytes'), num('projected', 'Projected footprint', 'bytes'), num('peak', 'Peak before expiry', 'bytes'), num('capacity', 'Reported capacity', 'bytes')],
  runway: [name('Repository name'), id, ...repository, field('status', 'Trend evidence'), num('used', 'Used space', 'gb'), num('free', 'Free space', 'gb'), num('capacity', 'Capacity', 'gb'), num('utilization', 'Utilization', 'percent'), num('growth', 'Observed daily growth', 'gb-day'), num('days80', 'Days to 80% used', 'days'), num('projected30', 'Volume usage in 30 days', 'gb'), num('projected60', 'Volume usage in 60 days', 'gb'), num('projected90', 'Volume usage in 90 days', 'gb')],
  footprint: [name('Backup name'), id, ...repository, field('job', 'Job'), field('status', 'Model evidence'), num('size', 'Retained file footprint', 'bytes'), num('files', 'Unique files'), num('objects', 'Workloads'), num('projected30', 'Modeled footprint in 30 days', 'bytes'), num('projected60', 'Modeled footprint in 60 days', 'bytes'), num('projected90', 'Modeled footprint in 90 days', 'bytes'), field('retention', 'Retention policy'), time],
  retention: [name('Backup file'), id, ...repository, field('backup', 'Backup'), field('job', 'Job'), field('status', 'Retention category'), num('size', 'File footprint', 'bytes'), time, field('holdUntil', 'Estimated hold until', 'date'), field('detail', 'Evidence')],
  hygiene: [name('Backup name'), id, ...repository, field('job', 'Job'), field('status', 'Review state'), field('issues', 'Review findings'), num('findings', 'Findings needing review'), num('size', 'Known file footprint', 'bytes'), num('age', 'Recovery point age', 'days'), time, field('latestFile', 'Latest file', 'date')],
  overview: [name('Environment'), id, field('status', 'Evidence coverage'), time, num('jobs', 'Loaded jobs'), num('active', 'Active jobs'), num('attention', 'Jobs needing attention'), num('failed', 'Failed jobs'), num('warning', 'Warning jobs'), num('disabled', 'Disabled jobs'), num('completed', 'Completed protection runs'), num('successful', 'Successful runs'), num('failedRuns', 'Failed runs'), num('warningRuns', 'Warning runs'), num('successRate', 'Session success rate', 'percent'), num('repositories', 'Storage extents / repositories'), num('atRisk', 'Repositories at risk'), num('securityIssues', 'Security checks not passed')],
  proxies: [name('Proxy name'), id, field('type', 'Proxy type'), field('status', 'Proxy readiness'), field('host', 'Managed host'), field('transport', 'Transport mode'), num('tasks', 'Configured task limit'), field('online', 'Online'), field('enabled', 'Enabled'), field('outdated', 'Out of date'), field('fallback', 'Network fallback')],
  servers: [name('Managed server'), id, field('type', 'Server type'), field('status', 'Reported status'), field('updates', 'Update state'), field('roles', 'Infrastructure roles'), num('assignments', 'Role assignments'), field('deadline', 'Update deadline', 'date')],
  licenses: [name('Entitlement'), id, field('status', 'License status'), field('type', 'License type'), field('unit', 'Entitlement unit'), num('licensed', 'Licensed units'), num('consumed', 'Consumed units'), num('remaining', 'Remaining units'), num('utilization', 'Entitlement utilization', 'percent'), num('days', 'Days to license expiry', 'days'), num('supportDays', 'Days to support expiry', 'days'), field('expires', 'License expiry', 'date'), field('support', 'Support expiry', 'date'), field('issues', 'License findings')],
} satisfies Record<string, Field[]>
export const fieldsFor = (source: keyof typeof fieldCatalog): Field[] => fieldCatalog[source]
export function defaultColumns(source: keyof typeof fieldCatalog): string[] {
  if (source === 'forecast') return ['repository', 'time', 'recorded', 'projected', 'peak']
  if (source === 'runway') return ['name', 'utilization', 'growth', 'days80', 'projected30']
  if (source === 'footprint') return ['name', 'repository', 'size', 'projected30', 'status']
  if (source === 'retention') return ['name', 'backup', 'repository', 'status', 'size']
  if (source === 'hygiene') return ['name', 'repository', 'status', 'age', 'issues']
  if (source === 'overview') return ['name', 'active', 'attention', 'successRate', 'atRisk']
  if (source === 'proxies') return ['name', 'status', 'host', 'transport', 'tasks']
  if (source === 'servers') return ['name', 'type', 'status', 'updates', 'roles']
  if (source === 'licenses') return ['name', 'status', 'consumed', 'licensed', 'unit', 'days']
  if (source === 'repositories') return ['name', 'used', 'free', 'capacity', 'utilization']
  if (source === 'history') return ['jobName', 'status', 'time', 'duration']
  if (source === 'jobs') return ['name', 'status', 'result', 'objects', 'progress']
  if (source === 'malware') return ['name', 'severity', 'status', 'type', 'engine']
  if (source === 'security') return ['name', 'status']
  return ['name', 'platform', 'status', 'repository', 'size']
}
