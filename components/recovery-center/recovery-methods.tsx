// Open Backup UI v1.0.2
import {useId} from 'react'
import {ChevronRight, Layers2} from 'lucide-react'
import {recoveryKindLabel, recoveryKinds, type RecoveryKind} from '@/lib/restore-points/recovery-picker'
import {useRecoveryPresentation} from '../restore-points/use-presentation'
import {RecoveryKindArt} from './recovery-kind-art'
import styles from './launcher.module.css'

const groups = {machines: 'Virtual machines', files: 'Files and disks', apps: 'Application items'} as const
const methods: Record<RecoveryKind, {group: keyof typeof groups; description: string}> = {
  'instant-vm': {group: 'machines', description: 'Run a VM directly from backup.'},
  'entire-vm': {group: 'machines', description: 'Restore the VM, its disks, and its configuration.'},
  'guest-files': {group: 'files', description: 'Browse and recover individual files and folders.'},
  'instant-disk': {group: 'files', description: 'Mount a backed-up disk as a vSphere First Class Disk.'},
  'publish-disks': {group: 'files', description: 'Expose backup disks through a mount server.'},
  sql: {group: 'apps', description: 'Recover databases from a SQL Server instance.'},
  'active-directory': {group: 'apps', description: 'Recover directory objects and their attributes.'},
}

export function RecoveryMethods({onChoose}: {onChoose: (kind: RecoveryKind) => void}) {
  const {t, formatNumber} = useRecoveryPresentation()
  const id = useId()
  return <div className={styles.methodChooser}>
    {(Object.keys(groups) as (keyof typeof groups)[]).map(group => (
      <section key={group} data-group={group} className={styles.methodGroup} aria-labelledby={id + group}>
        <div className={styles.groupHeading}>
          <h3 id={id + group}>{t(groups[group])}</h3>
          {group === 'machines' && <span className={styles.batchHint}><Layers2 size={13} aria-hidden="true"/>{t('Up to {count} VMs', {count: formatNumber(32)})}</span>}
        </div>
        <div className={styles.methodList}>
          {recoveryKinds.filter(kind => methods[kind].group === group).map(kind => (
            <button key={kind} data-recovery-kind={kind} type="button" className={styles.methodCard}
              aria-labelledby={id + kind} aria-describedby={id + kind + '-description'} onClick={() => onChoose(kind)}>
              <span className={styles.artTile} aria-hidden="true"><RecoveryKindArt kind={kind}/></span>
              <span className={styles.methodCopy}>
                <strong id={id + kind}>{t(recoveryKindLabel[kind])}</strong>
                <span id={id + kind + '-description'}>{t(methods[kind].description)}</span>
              </span>
              <ChevronRight className={styles.cardArrow} size={16} aria-hidden="true"/>
            </button>
          ))}
        </div>
      </section>
    ))}
  </div>
}
