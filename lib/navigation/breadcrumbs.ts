import { lenses } from '../lens/navigation'

export const navigationLabels: Record<string,string> = {
  '/vbr/lens':'Protection Lens', '/vbr/topology':'Protection Topology', '/vbr/threat-center':'Ransomware Detection',
  '/vbr/jobs':'Jobs & Policies', '/vbr/jobs/profiles':'Policy Profiles', '/vbr/policies':'Policy Profiles', '/vbr/protected-data':'Protected Data',
  '/vbr/inventory/virtual':'Virtual Infrastructure', '/vbr/inventory/protection-groups':'Physical and Cloud',
  '/vbr/inventory/unstructured':'Unstructured Data', '/vbr/inventory/entra':'Microsoft Entra ID',
  '/vbr/infrastructure/repositories':'Backup Repositories', '/vbr/infrastructure/proxies':'Backup Proxies', '/vbr/infrastructure/managed-servers':'Managed Servers',
  '/vbm/dashboard':'Dashboard', '/vbm/jobs':'Backup Jobs', '/vbm/protected-items':'Protected Objects', '/vbm/organizations':'Organizations',
  '/vbm/infrastructure/repositories':'Backup Repositories', '/vbm/infrastructure/proxies':'Backup Proxies',
  '/analytics/threat-center':'Threat Center', '/analytics/alarms':'Alarms Overview', '/analytics/dashboards':'Dashboards',
  '/analytics/reports':'Report Catalog', '/analytics/saved-reports':'Saved Reports',
  '/administration/licensing':'Licensing', '/administration/data-sources':'Data Sources', '/administration/branding':'Branding',
  '/administration/ai-settings':'AI Integrations', '/administration/telemetry':'Telemetry',
  '/administration/identity/users':'Users', '/administration/identity/roles':'Roles',
  '/vro':'Recovery Plans', '/k10':'Overview',
}
export type Breadcrumb = { label:string; href?:string }
type Section = 'vbr'|'vbm'|'analytics'|'administration'|'vro'|'k10'
const defaults:Record<Section,string>={vbr:'Veeam Backup & Replication',vbm:'Veeam Backup for Microsoft 365',analytics:'Veeam ONE',administration:'Administration',vro:'Veeam Recovery Orchestrator',k10:'Kasten K10'}
const detailLabels:Record<string,string>={
  '/vbr/jobs':'Job Investigation','/vbr/protected-data':'Restore Points',
  '/vbr/infrastructure/repositories':'Repository Details','/vbr/infrastructure/proxies':'Proxy Details','/vbr/infrastructure/managed-servers':'Server Details',
  '/vbr/inventory/protection-groups':'Protection Group Details','/vbr/inventory/unstructured':'Source Details',
  '/vbm/jobs':'Session History','/vbm/protected-items':'Restore Points','/vbm/organizations':'Organization Details',
  '/vbm/infrastructure/repositories':'Repository Details','/vbm/infrastructure/proxies':'Proxy Details','/analytics/reports':'Report Workspace',
}

export function breadcrumbsForPath(pathname:string,sectionNames:Partial<Record<Section,string>>={}):Breadcrumb[] {
  const path=pathname.replace(/\/$/,'') || '/'
  const section=path.split('/')[1] as Section
  if(!defaults[section])return []
  const trail:Breadcrumb[]=[{label:sectionNames[section] || defaults[section]}]
  const parent=(href:string)=>({label:navigationLabels[href],href})
  if(path==='/administration/data-sources/filter-lab')return [...trail,parent('/administration/data-sources'),{label:'Filter Design Lab'}]
  const lens=lenses.find(item=>item.href===path)
  if(lens)return [...trail,parent('/vbr/lens'),{label:lens.title}]
  if(path.startsWith('/vbr/workloads/'))return [...trail,parent('/vbr/protected-data'),{label:'Workload Inspection'}]
  if(path.startsWith('/vbr/sessions/'))return [...trail,parent('/vbr/jobs'),{label:'Session Investigation'}]
  if(path==='/vbr/jobs/profiles' || path==='/vbr/policies')return [...trail,parent('/vbr/jobs'),{label:navigationLabels['/vbr/jobs/profiles']}]
  if(path.startsWith('/analytics/reports/saved-'))return [...trail,parent('/analytics/saved-reports'),{label:'Report Workspace'}]
  if(path.startsWith('/vbr/jobs/create')) {
    const labels:Record<string,string>={'/vbr/jobs/create':'Create Backup Job','/vbr/jobs/create-backup-copy':'Create Backup Copy Job','/vbr/jobs/create-entraid':'Create Microsoft Entra ID Job'}
    if(labels[path])return [...trail,parent('/vbr/jobs'),{label:labels[path]}]
  }
  const route=Object.keys(navigationLabels).sort((a,b)=>b.length-a.length).find(href=>path===href || path.startsWith(href+'/'))
  if(!route)return []
  if(route.includes('/infrastructure/'))trail.push({label:'Backup Infrastructure'})
  if(route.includes('/inventory/'))trail.push({label:'Inventory'})
  if(route.includes('/identity/'))trail.push({label:'Identity'})
  trail.push({label:navigationLabels[route],...(path!==route ? {href:route}:{})})
  if(path!==route)trail.push({label:detailLabels[route] || 'Details'})
  return trail
}
