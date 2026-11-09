'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { veeamApi } from '@/lib/api/veeam-client'
import { isFlagged, type RestorePoint } from '@/lib/restore-points/model'
import { beginRestoreLaunch, type RestoreLaunch } from '@/lib/restore-points/launch'
import type { InventoryKind, RestoreDraft, RestoreInventoryItem, RestoreOperation, RestoreOptions, RestoreTarget } from '@/lib/restore-points/workflow'
import { useRecoveryPresentation } from './use-presentation'
import { TargetPicker } from './target-picker'
import styles from './workflow.module.css'

function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (next: boolean) => void }) {
  return <label className={styles.check}><input type="checkbox" checked={value} onChange={event => onChange(event.target.checked)} />{label}</label>
}

export function RestoreWorkflow({ point, flagged, sourceKey, operation, onBack, onLaunch }: {
  point: RestorePoint; flagged: boolean; sourceKey?: string; operation: RestoreOperation; onBack: () => void; onLaunch: (receipt: RestoreLaunch) => void
}) {
  const { t, diagnostic, label } = useRecoveryPresentation()
  const [options, setOptions] = useState<RestoreOptions>()
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setOptions(undefined)
    setError('')
    veeamApi.getRestoreOptions(point.id, point.backupId, operation, controller.signal).then(result => {
      if (controller.signal.aborted) return
      if ((sourceKey && result.sourceKey !== sourceKey) || result.point.id !== point.id || result.point.backupId !== point.backupId || !result.point.allowedOperations?.includes(operation)) {
        setError(t('This operation is unavailable for the selected restore point.'))
      } else setOptions(result)
    }).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : t('Unable to load recovery points.')) })
    return () => controller.abort()
  }, [point.id, point.backupId, sourceKey, operation, revision, t])

  if (options) return <>
    {!flagged && isFlagged(options.point.malwareStatus) && <p className={styles.warning} role="alert"><ShieldAlert size={17} />{t('Point malware status')} · {label(options.point.malwareStatus!)}</p>}
    {!!options.warnings?.length && <div role="status">{options.warnings.map(warning => <p key={warning} className={styles.warning}>{diagnostic(warning)}</p>)}</div>}
    <RestoreForm point={point} flagged={flagged || isFlagged(options.point.malwareStatus)} options={options} operation={operation} onBack={onBack} onLaunch={onLaunch} />
  </>
  return <div className={styles.flow}>
    {error ? <p role="alert" className={styles.error}>{diagnostic(error)}</p> : <p className={styles.status} role="status"><Loader2 className="animate-spin" size={16} />{t('Loading recovery options…')}</p>}
    <div className={styles.actions}><Button variant="outline" onClick={onBack}>{t('Back')}</Button>
      {error && <Button variant="outline" onClick={() => setRevision(value => value + 1)}>{t('Retry')}</Button>}</div>
  </div>
}

function RestoreForm({ point, flagged, options, operation, onBack, onLaunch }: {
  point: RestorePoint; flagged: boolean; options: RestoreOptions; operation: RestoreOperation; onBack: () => void; onLaunch: (receipt: RestoreLaunch) => void
}) {
  const { t, label } = useRecoveryPresentation()
  const flr = operation === 'StartFlrRestore'
  const fcd = operation === 'StartFCDInstantRecovery'
  const publish = operation === 'StartDiskPublish'
  const vm = !flr && !fcd && !publish
  const instantVi = operation === 'StartViVMInstantRecovery'
  const fullVi = operation === 'StartEntireVmRestore'
  const full = fullVi || operation === 'StartEntireVmRestoreHyperV' || operation === 'StartEntireVmRestoreCloudDirector'
  const hyperV = operation === 'StartHvVMInstantRecovery' || operation === 'StartEntireVmRestoreHyperV'
  const cloud = operation === 'StartEntireVmRestoreCloudDirector'
  const sourcePlatform = (options.point.platformName || '').toLowerCase()
  const crossPlatform = (instantVi && !['vmware', 'vsphere'].includes(sourcePlatform)) || (operation === 'StartHvVMInstantRecovery' && !['hyperv', 'hyper-v'].includes(sourcePlatform))
  const [custom, setCustom] = useState(crossPlatform)
  const [server, setServer] = useState<RestoreInventoryItem>()
  const [target, setTarget] = useState<RestoreTarget>({vmName: (point.name || 'VM') + '-recovered'})
  const [disks, setDisks] = useState<NonNullable<RestoreDraft['disks']>>([])
  const [allDisks, setAllDisks] = useState(true)
  const [guestOs, setGuestOs] = useState<'Windows' | 'Linux'>(/linux|unix/i.test(options.point.guestOsFamily || '') ? 'Linux' : 'Windows')
  const [mountServer, setMountServer] = useState('')
  const [ips, setIps] = useState('')
  const [reason, setReason] = useState('')
  const [powerUp, setPowerUp] = useState(false)
  const [network, setNetwork] = useState(false)
  const [credentialsId, setCredentialsId] = useState('')
  const [tags, setTags] = useState(true)
  const [overwrite, setOverwrite] = useState(false)
  const [scan, setScan] = useState(flagged)
  const [networkMode, setNetworkMode] = useState<NonNullable<RestoreDraft['networkMode']>>('Original')
  const [mapping, setMapping] = useState<Record<string, RestoreInventoryItem | undefined>>({})
  const canMap = custom && (fullVi || hyperV || (instantVi && crossPlatform))
  const networks = options.networks || []
  const validNetworks = !canMap || networkMode !== 'Mapped' || (networks.length > 0 && networks.every(nic => !!mapping[nic.id] || hyperV))
  const [rollback, setRollback] = useState(false)
  const canOverwrite = instantVi || fullVi || (hyperV && custom)
  const canRestoreTags = (instantVi && !crossPlatform) || (fullVi && custom)
  const [review, setReview] = useState(false)
  const lock = useRef(false)
  const ipList = ips.trim().split(/[\s,]+/).filter(Boolean)
  const validTarget = !vm || !custom || (!!target.host && !!target.vmName?.trim() && (!fullVi || !!target.folder))
  const validDisks = !fcd || (!!target.cluster && disks.length > 0 && disks.every(disk => disk.mountedName.trim() && disk.registeredName.trim()))
  const valid = validTarget && validDisks && validNetworks && (!publish || (ipList.length > 0 && (allDisks || disks.length > 0))) && (!flr || guestOs === 'Windows' || !!mountServer)
  const setTargetField = <K extends keyof RestoreTarget>(field: K, value: RestoreTarget[K]) => setTarget(previous => ({ ...previous, [field]: value }))
  const picker = (kind: Exclude<InventoryKind, 'Server'>, field: 'host' | 'cluster' | 'folder' | 'resourcePool' | 'datastore', prompt: string, required = false) =>
    <TargetPicker label={prompt} kind={kind} platform={hyperV ? 'HyperV' : 'VSphere'} sourceKey={options.sourceKey} server={server?.hostName} required={required}
      value={target[field]} onChange={item => setTargetField(field, item)} />
  function toggleDisk(uid: string, name: string, checked: boolean) {
    setDisks(previous => checked ? [...previous, { uid, mountedName: name, registeredName: name + '-recovered' }] : previous.filter(disk => disk.uid !== uid))
  }
  function changeDisk(uid: string, field: 'mountedName' | 'registeredName', value: string) {
    setDisks(previous => previous.map(disk => disk.uid === uid ? { ...disk, [field]: value } : disk))
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!valid || lock.current) return
    if (!review) { setReview(true); return }
    lock.current = true
    const draft: RestoreDraft = {
      sourceKey: options.sourceKey, restorePointId: point.id, backupId: point.backupId, operation,
      mode: custom ? 'Customized' : 'OriginalLocation', reason: reason.trim() || undefined,
      reviewedMalwareStatus: options.point.malwareStatus || undefined,
      ...(vm && { powerUp, antivirusScan: scan }),
      ...(instantVi && { nicsEnabled: crossPlatform ? networkMode !== 'Disconnected' : network }),
      ...(canMap && { networkMode, ...(networkMode === 'Mapped' && { networkMappings: networks.map(nic => ({sourceId: nic.id, target: mapping[nic.id]})) }) }),
      ...(canOverwrite && { overwrite }),
      ...(canRestoreTags && { restoreTags: tags }),
      ...(full && !custom && { quickRollback: rollback }),
      ...(vm && custom && { target }),
      ...(fcd && { target: { cluster: target.cluster, datastore: target.datastore }, disks }),
      ...(flr && { guestOs, mountServerId: mountServer || undefined, credentialsId: credentialsId || undefined }),
      ...(publish && { allowedIps: ipList, disks: allDisks ? undefined : disks }),
    }
    onLaunch(beginRestoreLaunch(draft, options.point.name || point.name || point.id, point.creationTime || undefined, value => veeamApi.startRestore(value)))
  }

  return <form className={styles.flow} onSubmit={submit}>
    {!review ? <>
      {vm && !cloud && <fieldset className={styles.location}><legend>{t('Destination')}</legend>
        {!crossPlatform && <label><input type="radio" checked={!custom} onChange={() => setCustom(false)} name="restore-location" />{t('Original location')}</label>}
        <label><input type="radio" checked={custom} onChange={() => setCustom(true)} name="restore-location" />{t('New location')}</label>
      </fieldset>}
      {(vm && custom || fcd) && <div className={styles.fields}>
        {vm && <label className={styles.field}>{t('Restored VM name')}<Input required value={target.vmName ?? ''} onChange={event => setTargetField('vmName', event.target.value)} /></label>}
        <TargetPicker label={t('Inventory server')} kind="Server" platform={hyperV ? 'HyperV' : 'VSphere'} sourceKey={options.sourceKey} value={server} required
          onChange={item => { setServer(item); setMapping({}); setTarget(previous => ({ vmName: previous.vmName })) }} />
        {server && <>
          {fcd ? picker('Cluster','cluster',t('Cluster'),true) : picker('Host','host',t('Host'),true)}
          {vm && !hyperV && picker('Folder','folder',t('Folder'),fullVi)}
          {vm && !hyperV && picker('ResourcePool','resourcePool',t('Resource pool'))}
          {!hyperV && picker('Datastore','datastore',fcd || instantVi ? t('Write cache datastore') : t('Datastore'))}
          {hyperV && <label className={styles.field}>{t('Storage path')}<Input value={target.storagePath || ''} onChange={event => setTargetField('storagePath',event.target.value || undefined)} /></label>}
        </>}
      </div>}
      {canMap && <div className={styles.fields}>
        <label className={styles.field}>{t('Network adapters')}<select value={networkMode} onChange={event => setNetworkMode(event.target.value as typeof networkMode)}>
          <option value="Original">{t('Use source settings')}</option><option value="Disconnected">{t('Disconnect all adapters')}</option>
          <option value="Mapped" disabled={!server || !networks.length}>{t('Map networks')}</option>
        </select></label>
        {networkMode === 'Mapped' && server && networks.map(nic => <TargetPicker key={nic.id} label={nic.name} kind="Network" platform={hyperV ? 'HyperV' : 'VSphere'}
          sourceKey={options.sourceKey} server={server.hostName} value={mapping[nic.id]} required={!hyperV} emptyLabel={t('Disconnected')}
          onChange={item => setMapping(previous => ({...previous, [nic.id]: item}))} />)}
      </div>}
      {(fcd || publish) && <fieldset className={styles.diskList}><legend>{t('Disks')}</legend>
        {publish && <Check label={t('All')} value={allDisks} onChange={setAllDisks} />}
        {!options.disks.length && (!publish || !allDisks) && <p>{t('No disks were returned for this restore point.')}</p>}
        {(!publish || !allDisks) && options.disks.map(disk => {
          const mapping = disks.find(item => item.uid === disk.uid)
          return <div key={disk.uid}><Check label={disk.name} value={!!mapping} onChange={checked => toggleDisk(disk.uid, disk.name, checked)} />
            {mapping && fcd && <div className={styles.fields}>
              <label className={styles.field}>{t('Mounted disk name')}<Input required value={mapping.mountedName} onChange={event => changeDisk(disk.uid,'mountedName',event.target.value)} /></label>
              <label className={styles.field}>{t('Registered FCD name')}<Input required value={mapping.registeredName} onChange={event => changeDisk(disk.uid,'registeredName',event.target.value)} /></label>
            </div>}</div>
        })}
      </fieldset>}
      {flr && <div className={styles.fields}>
        <label className={styles.field}>{t('Operating system')}<select value={guestOs} disabled={['Windows','Linux'].includes(options.point.guestOsFamily || '')} onChange={event => { setGuestOs(event.target.value as 'Windows' | 'Linux'); setMountServer('') }}>
          <option value="Windows">{t('Windows')}</option><option value="Linux">{t('Linux')}</option></select></label>
        <label className={styles.field}>{t('Mount server')}<select required={guestOs === 'Linux'} value={mountServer} onChange={event => setMountServer(event.target.value)}>
          <option value="">{guestOs === 'Windows' ? t('Automatic selection') : t('Select a destination')}</option>
          {options.mountServers.filter(item => !item.type || item.type.toLowerCase().includes(guestOs.toLowerCase())).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select></label>
        {guestOs === 'Windows' && !!options.credentials?.length && <label className={styles.field}>{t('Credentials')}<select value={credentialsId} onChange={event => setCredentialsId(event.target.value)}>
          <option value="">{t('Automatic selection')}</option>{options.credentials.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>}
      </div>}
      {publish && <label className={styles.field}>{t('Allowed iSCSI initiator IP addresses')}<Input value={ips} required onChange={event => setIps(event.target.value)} /></label>}
      {vm && <div className={styles.checks}>
        <Check label={t('Power on the VM')} value={powerUp} onChange={setPowerUp} />
        {instantVi && !crossPlatform && <Check label={t('Connect network adapters')} value={network} onChange={setNetwork} />}
        <Check label={t('Scan for malware before recovery')} value={scan} onChange={setScan} />
        {canRestoreTags && <Check label={t('Restore VM tags')} value={tags} onChange={setTags} />}
        {canOverwrite && <Check label={t('Overwrite an existing VM')} value={overwrite} onChange={setOverwrite} />}
        {full && !custom && <Check label={t('Quick rollback')} value={rollback} onChange={setRollback} />}
      </div>}
      <label className={styles.field}>{t('Reason')}<Input maxLength={1024} value={reason} placeholder={t('Optional')} onChange={event => setReason(event.target.value)} /></label>
    </> : <>
      <h3>{t('Review')}</h3>
      <dl className={styles.summary}>
        <div><dt>{t('Restore point ID')}</dt><dd>{point.id}</dd></div>
        <div><dt>{t('Point malware status')}</dt><dd>{options.point.malwareStatus ? label(options.point.malwareStatus) : t('Unknown')}</dd></div>
        {vm && <><div><dt>{t('Destination')}</dt><dd>{custom ? [target.host?.name,target.folder?.name,target.vmName].filter(Boolean).join(' / ') : t('Original location')}</dd></div>
          {custom && target.resourcePool && <div><dt>{t('Resource pool')}</dt><dd>{target.resourcePool.name}</dd></div>}
          {custom && target.datastore && <div><dt>{t('Datastore')}</dt><dd>{target.datastore.name}</dd></div>}
          {custom && target.storagePath && <div><dt>{t('Storage path')}</dt><dd>{target.storagePath}</dd></div>}
          <div><dt>{t('Power on the VM')}</dt><dd>{powerUp ? t('Yes') : t('No')}</dd></div>
          {instantVi && !crossPlatform && <div><dt>{t('Connect network adapters')}</dt><dd>{network ? t('Yes') : t('No')}</dd></div>}
          {canMap && <div><dt>{t('Network adapters')}</dt><dd>{networkMode === 'Original' ? t('Use source settings') : networkMode === 'Disconnected' ? t('Disconnect all adapters') :
            networks.map(nic => <p key={nic.id}>{nic.name} → {mapping[nic.id]?.name || t('Disconnected')}</p>)}</dd></div>}
          {canRestoreTags && <div><dt>{t('Restore VM tags')}</dt><dd>{tags ? t('Yes') : t('No')}</dd></div>}
          {canOverwrite && <div><dt>{t('Overwrite an existing VM')}</dt><dd>{overwrite ? t('Yes') : t('No')}</dd></div>}
          <div><dt>{t('Antivirus')}</dt><dd>{scan ? t('Enabled') : t('Disabled')}</dd></div>
          {full && !custom && rollback && <div><dt>{t('Quick rollback')}</dt><dd>{t('Enabled')}</dd></div>}</>}
        {flr && <><div><dt>{t('Operating system')}</dt><dd>{guestOs}</dd></div><div><dt>{t('Mount server')}</dt><dd>{options.mountServers.find(item => item.id === mountServer)?.name || t('Automatic selection')}</dd></div></>}
        {fcd && <><div><dt>{t('Cluster')}</dt><dd>{target.cluster?.name}</dd></div>
          {target.datastore && <div><dt>{t('Write cache datastore')}</dt><dd>{target.datastore.name}</dd></div>}
          {disks.map(disk => <div key={disk.uid}><dt>{options.disks.find(item => item.uid === disk.uid)?.name}</dt><dd>{disk.mountedName} → {disk.registeredName}</dd></div>)}</>}
        {publish && <><div><dt>{t('Allowed iSCSI initiator IP addresses')}</dt><dd>{ipList.join(', ')}</dd></div>
          <div><dt>{t('Disks')}</dt><dd>{allDisks ? t('All') : disks.map(chosen => options.disks.find(item => item.uid === chosen.uid)?.name).join(', ')}</dd></div></>}
        {reason.trim() && <div><dt>{t('Reason')}</dt><dd>{reason}</dd></div>}
      </dl>
      {(full && !custom || canOverwrite && overwrite) && <p className={styles.warning}><ShieldAlert size={17} />{t('This recovery can replace the existing VM.')}</p>}
    </>}
    <div className={styles.actions}>
      <Button variant="outline" type="button" onClick={() => { if (review) setReview(false); else onBack() }}><ArrowLeft size={14} />{t('Back')}</Button>
      <Button type="submit" disabled={!valid}>{review ? label(operation) : t('Review')}<ArrowRight size={14} /></Button>
    </div>
  </form>
}
