"use client"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Empty, date } from '@/components/investigation/shared'
import { validId } from '@/lib/investigation/model'
import { entityIssues, statusLabel, type DiscoveredEntity } from '@/lib/protection-groups/model'
import { Badge } from './shared'
import styles from './protection-operations.module.css'

export function EntityDetail({ entity, entities, close }: { entity: DiscoveredEntity | null; entities: DiscoveredEntity[]; close: () => void }) {
  const e = entity, parent = entities.find(p => p.id === e?.parentId)
  return <Dialog open={!!e} onOpenChange={open => { if (!open) close() }}><DialogContent className={styles.entityDialog}><DialogHeader><DialogTitle>{e?.name || 'Discovered entity'}</DialogTitle><DialogDescription>Reported discovery and component evidence for this entity.</DialogDescription></DialogHeader>{e && <>
    <div className={styles.detailGrid}><div><h3>Discovery & identity</h3><dl className={styles.facts}>
      <div><dt>Entity type</dt><dd>{statusLabel(e.type)}</dd></div><div><dt>Entity ID</dt><dd><code>{e.id}</code></dd></div>
      <div><dt>Parent</dt><dd>{parent?.name || (validId(e.parentId) ? e.parentId : 'Not reported')}</dd></div>
      <div><dt>Operating system</dt><dd>{e.operatingSystemVersion || e.operatingSystem || 'Not reported'} {e.operatingSystemPlatform}</dd></div>
      <div><dt>IP addresses</dt><dd>{e.ipAddresses?.join(', ') || 'Not reported'}</dd></div>
      <div><dt>Last agent connection</dt><dd>{date(e.lastConnected)}</dd></div>
    </dl></div><div><h3>Agent & components</h3>{e.type === 'Computer' ? <dl className={styles.facts}>
      <div><dt>Computer connectivity</dt><dd><Badge value={e.state}/></dd></div>
      <div><dt>Agent</dt><dd><Badge value={e.agentStatus}/><div className={styles.muted}>{e.agentVersion || 'Version not reported'}</div></dd></div>
      <div><dt>CBT driver</dt><dd><Badge value={e.driverStatus}/><div className={styles.muted}>{e.driverVersion || 'Version not reported'}</div></dd></div>
      <div><dt>Certificate trust</dt><dd><Badge value={e.isTrusted === true ? 'Trusted' : e.isTrusted === false ? 'Not trusted' : 'Not reported'} tone={e.isTrusted === false ? 'warning' : 'neutral'}/></dd></div>
      <div><dt>Reboot requirement</dt><dd>{entityIssues(e).reboot ? 'Required' : e.rebootRequired === false ? 'Not required' : 'Not reported'}</dd></div>
    </dl> : <Empty>Computer health fields do not apply to this container.</Empty>}</div></div>
    {e.type === 'Computer' && <><h3>Application plug-ins</h3>{e.plugins?.length ? e.plugins.map((p,i) => <div key={i} className={styles.plugin}><div>{p.type || 'Type not reported'}<small>{p.version || 'Version not reported'}</small></div><Badge value={p.status}/></div>) : <p className={styles.muted}>{e.plugins ? 'No plug-ins returned.' : 'Plug-in inventory not reported.'}</p>}
      <h3>Embedded recovery media</h3><p><Badge value={e.embeddedRecoveryMediaState?.state}/></p><p className={styles.muted}>Updated {date(e.embeddedRecoveryMediaState?.lastUpdateDate)}</p>{e.embeddedRecoveryMediaState?.message && <p className="text-sm break-words">{e.embeddedRecoveryMediaState.message}</p>}
    </>}
  </>}</DialogContent></Dialog>
}
