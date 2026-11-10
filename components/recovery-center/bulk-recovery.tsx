'use client'
// Open Backup UI v1.2.0
import {useRef,useState} from 'react'
import Link from 'next/link'
import {v4 as uuid} from 'uuid'
import {ArrowLeft,ArrowRight,Settings2} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {veeamApi} from '@/lib/api/veeam-client'
import type {BatchInput} from '@/lib/restore-points/batch'
import {sameRecoveryDestination} from '@/lib/restore-points/destination-collision'
import type {PickedVm} from '@/lib/restore-points/recovery-picker'
import {isFlagged} from '@/lib/restore-points/model'
import {uncertainRestore,type RestoreDraft,type RestoreInventoryItem,type RestorePlatform,type RestoreTarget} from '@/lib/restore-points/workflow'
import {RestoreWorkflow} from '../restore-points/restore-workflow'
import {TargetPicker} from '../restore-points/target-picker'
import {useRecoveryPresentation} from '../restore-points/use-presentation'
import {VmIdentity} from './vm-identity'
import styles from './launcher.module.css'

const platformOf=(op:PickedVm['operation']):RestorePlatform|undefined=>op==='StartEntireVmRestoreCloudDirector'?undefined:
  op==='StartHvVMInstantRecovery'||op==='StartEntireVmRestoreHyperV'?'HyperV':'VSphere'
function originalAllowed(vm:PickedVm){
  const src=vm.point.platformName?.toLowerCase().replace('-','')
  return vm.operation==='StartViVMInstantRecovery'?src==='vmware'||src==='vsphere':vm.operation==='StartHvVMInstantRecovery'?src==='hyperv':true
}
const replacesOriginal=(draft:RestoreDraft)=>draft.mode==='OriginalLocation'&&['StartHvVMInstantRecovery','StartEntireVmRestoreHyperV','StartEntireVmRestoreCloudDirector'].includes(draft.operation)
function VmReview({draft}:{draft:RestoreDraft}){
  const {t}=useRecoveryPresentation(),custom=draft.mode==='Customized',vi=draft.operation==='StartViVMInstantRecovery',fullVi=draft.operation==='StartEntireVmRestore'
  const full=draft.operation.startsWith('StartEntireVmRestore'),target=draft.target
  const yn=(flag?:boolean)=>t(flag?'Yes':'No')
  const facts:[string,string|undefined][]=[
    [t('Destination'),t(custom?'New location':'Original location')],[t('Restored VM name'),target?.vmName],[t('Host'),target?.host?.name],
    [t('Folder'),target?.folder?.name],[t('Resource pool'),target?.resourcePool?.name],[t(vi?'Write cache datastore':'Datastore'),target?.datastore?.name],[t('Storage path'),target?.storagePath],
    [t('Power on the VM'),yn(draft.powerUp)],[t('Antivirus'),t(draft.antivirusScan?'Enabled':'Disabled')],
    [t('Connect network adapters'),vi?yn(draft.nicsEnabled):undefined],
    [t('Network adapters'),custom&&(!vi||draft.networkMode)?draft.networkMode==='Mapped'?(draft.networkMappings||[]).map(m=>m.sourceId+' → '+(m.target?.name||t('Disconnected'))).join('\n'):t(draft.networkMode==='Disconnected'?'Disconnect all adapters':'Use source settings'):undefined],
    [t('Overwrite an existing VM'),(vi||fullVi||custom||replacesOriginal(draft))?yn(draft.overwrite):undefined],
    [t('Restore VM tags'),vi||(custom&&fullVi)?yn(draft.restoreTags??true):undefined],
    [t('Quick rollback'),full&&!custom?yn(draft.quickRollback):undefined],[t('Reason'),draft.reason],
  ]
  return <dl className={styles.reviewFacts}>{facts.filter(([,v])=>v).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
}
export function BulkRecovery({sourceKey,vms,onBack,onAccepted,onBusy}:{sourceKey:string;vms:PickedVm[];onBack:()=>void;onAccepted:(id:string)=>void;onBusy:(busy:boolean)=>void}){
  const {t,date,label,diagnostic,formatNumber}=useRecoveryPresentation()
  const [overrides,setOverrides]=useState<Record<string,RestoreDraft>>({}),[editing,setEditing]=useState<PickedVm>(),[review,setReview]=useState(false)
  const [customServers,setCustomServers]=useState<Record<string,RestoreInventoryItem|undefined>>({})
  const [power,setPower]=useState(false),[scan,setScan]=useState(vms.some(vm=>isFlagged(vm.point.malwareStatus))),[reason,setReason]=useState('')
  const platforms=[...new Set(vms.map(vm=>platformOf(vm.operation)))],platform=platforms.length===1?platforms[0]:undefined
  const [custom,setCustom]=useState(!!platform&&vms.some(vm=>!originalAllowed(vm))),[server,setServer]=useState<RestoreInventoryItem>(),[target,setTarget]=useState<RestoreTarget>({})
  const [names,setNames]=useState<Record<string,string>>({}),[confirmReplace,setConfirmReplace]=useState(false),[confirmFlags,setConfirmFlags]=useState(false)
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[unknown,setUnknown]=useState(''),lock=useRef(false),requestId=useRef('')
  const drafts:BatchInput['items']=vms.map(vm=>{
    const id=vm.object.objectId,operation=vm.operation!
    const draft:RestoreDraft=overrides[id]||{sourceKey,operation,restorePointId:vm.point.id,backupId:vm.point.backupId,mode:custom?'Customized':'OriginalLocation',reason:reason.trim()||undefined,
      reviewedMalwareStatus:vm.point.malwareStatus||undefined,powerUp:power,antivirusScan:scan,
      ...(operation==='StartViVMInstantRecovery'&&{nicsEnabled:false}),...(custom&&{target:{...target,vmName:(names[id]??vm.object.name+'-recovered').trim()}})}
    return {objectId:id,name:vm.object.name,draft:replacesOriginal(draft)?{...draft,overwrite:confirmReplace}:draft}
  })
  const originals=drafts.filter(i=>replacesOriginal(i.draft))
  const flagged=drafts.filter(i=>isFlagged(i.draft.reviewedMalwareStatus))
  const destinations=drafts.filter(i=>i.draft.mode==='Customized'&&i.draft.target?.vmName?.trim()&&i.draft.target.host).map(({draft})=>({
    platform:platformOf(draft.operation)||'',manager:draft.target?.host?.hostName||'',folder:draft.target?.folder?.objectId||draft.target?.folder?.urn||'',name:draft.target?.vmName||'',
  }))
  const repeated=destinations.some((a,i)=>destinations.slice(i+1).some(b=>sameRecoveryDestination(a,b)))
  const valid=!repeated&&drafts.every(({draft},index)=>draft.mode==='OriginalLocation'?originalAllowed(vms[index]):!!draft.target?.host&&!!draft.target.vmName?.trim()&&(draft.operation!=='StartEntireVmRestore'||!!draft.target.folder))
  function edit(){setReview(false);setConfirmFlags(false);setConfirmReplace(false);setError('');requestId.current=''}
  async function start(){
    if(lock.current||!valid||(!confirmReplace&&originals.length>0)||(!confirmFlags&&flagged.length>0))return
    lock.current=true;onBusy(true);setBusy(true);setError('')
    requestId.current||=uuid()
    try{
      const receipt=await veeamApi.startRestoreBatch({batchId:requestId.current,sourceKey,items:drafts})
      if(receipt.id!==requestId.current||receipt.sourceKey!==sourceKey){setUnknown(requestId.current);return}
      onAccepted(receipt.id)
    }catch(e){setError(diagnostic(e instanceof Error?e.message:String(e)));if(uncertainRestore(e))setUnknown(requestId.current);else lock.current=false}
    finally{setBusy(false);onBusy(false)}
  }
  const vmName=(vm:PickedVm)=>names[vm.object.objectId]??vm.object.name+'-recovered'
  if(editing)return <><h3>{editing.object.name}</h3><RestoreWorkflow point={editing.point} sourceKey={sourceKey} operation={editing.operation!} flagged={isFlagged(editing.point.malwareStatus)}
    initialDraft={drafts.find(v=>v.objectId===editing.object.objectId)?.draft} initialServer={overrides[editing.object.objectId]?customServers[editing.object.objectId]:server}
    onBack={()=>setEditing(undefined)} onLaunch={()=>{}} onDraft={(draft,inventoryServer)=>{setOverrides(prior=>({...prior,[editing.object.objectId]:draft}));setCustomServers(prior=>({...prior,[editing.object.objectId]:inventoryServer}));setEditing(undefined);edit()}}/></>
  if(unknown)return <div role="alert"><p>{t('VBR may have received this batch. Check its status before starting another recovery.')}</p>
    <Button asChild><Link href={'/vbr/recovery-center/batches/'+unknown+'?sourceKey='+sourceKey}>{t('Open batch')}</Link></Button></div>
  return <><fieldset className={styles.batchFields} disabled={busy}>
    {!review?<><h3>{t('Shared recovery settings')}</h3><p className={styles.notice}>{t('These settings apply to each VM unless you customize it below.')}</p>
      <label className={styles.field}>{t('Destination')}<select value={custom?'new':'original'} onChange={e=>setCustom(e.target.value==='new')}>
        <option value="original">{t('Original location')}</option>{platform&&<option value="new">{t('New location')}</option>}</select></label>
      {custom&&platform&&<div className={styles.grid}>
        <TargetPicker label={t('Inventory server')} kind="Server" platform={platform} sourceKey={sourceKey} value={server} required onChange={item=>{setServer(item);setTarget({})}}/>
        {server&&<><TargetPicker label={t('Host')} kind="Host" platform={platform} sourceKey={sourceKey} server={server.hostName} required value={target.host} onChange={host=>setTarget(v=>({...v,host}))}/>
          {platform==='VSphere'?<>
            <TargetPicker label={t('Folder')} kind="Folder" platform={platform} sourceKey={sourceKey} server={server.hostName} required={vms.some(v=>v.operation==='StartEntireVmRestore')} value={target.folder} onChange={folder=>setTarget(v=>({...v,folder}))}/>
            <TargetPicker label={t('Resource pool')} kind="ResourcePool" platform={platform} sourceKey={sourceKey} server={server.hostName} value={target.resourcePool} onChange={resourcePool=>setTarget(v=>({...v,resourcePool}))}/>
            <TargetPicker label={t(vms[0].operation==='StartViVMInstantRecovery'?'Write cache datastore':'Datastore')} kind="Datastore" platform={platform} sourceKey={sourceKey} server={server.hostName} value={target.datastore} onChange={datastore=>setTarget(v=>({...v,datastore}))}/>
          </>:<label className={styles.field}>{t('Storage path')}<input value={target.storagePath||''} onChange={e=>setTarget(v=>({...v,storagePath:e.target.value}))}/></label>}</>}
      </div>}
      <div className={styles.flags}><label><input type="checkbox" checked={power} onChange={e=>setPower(e.target.checked)}/>{t('Power on the VM')}</label>
        <label><input type="checkbox" checked={scan} onChange={e=>setScan(e.target.checked)}/>{t('Scan for malware before recovery')}</label></div>
      <label className={styles.field}>{t('Reason')}<input value={reason} maxLength={1024} onChange={e=>setReason(e.target.value)} placeholder={t('Optional')}/></label></>:<h3>{t('Review batch')}</h3>}
    <div className={styles.batchItems}>{vms.map((vm,i)=>{
      const id=vm.object.objectId,draft=drafts[i].draft,override=!!overrides[id]
      return <article key={id} className={styles.chosen}><div className={styles.rowHead}><strong>{vm.object.name}</strong>{!review&&<Button size="sm" variant="outline" onClick={()=>setEditing(vm)}><Settings2 size={13}/>{t('Customize')}</Button>}</div>
        <VmIdentity object={vm.object}/>
        <p>{label(vm.operation!)} · {date(vm.point.creationTime)}</p><p>{vm.object.copies.find(c=>c.backupId===vm.point.backupId)?.name||vm.point.backupId}</p>
        {custom&&!override&&!review&&<label className={styles.field}>{t('Restored VM name')}<input value={vmName(vm)} maxLength={255} onChange={e=>setNames(n=>({...n,[id]:e.target.value}))}/></label>}
        {!review&&override&&<p>{draft.mode==='OriginalLocation'?t('Original location'):[draft.target?.vmName,draft.target?.host?.name,draft.target?.folder?.name,draft.target?.datastore?.name,draft.target?.storagePath].filter(Boolean).join(' · ')}</p>}
        {review&&<VmReview draft={draft}/>}
        {isFlagged(draft.reviewedMalwareStatus)&&<strong className={styles.warning}>{t('Point malware status')} · {label(draft.reviewedMalwareStatus!)}</strong>}
        {review&&(replacesOriginal(draft)||draft.overwrite||(draft.operation.startsWith('StartEntireVmRestore')&&draft.mode==='OriginalLocation'))&&<p className={styles.warning}>{t('This recovery can replace the existing VM.')}</p>}
        {!override&&!custom&&!originalAllowed(vm)&&<p className={styles.warning}>{t('Choose a new location for this VM.')}</p>}
        {!review&&override&&<button type="button" className={styles.link} onClick={()=>setOverrides(old=>{const next={...old};delete next[id];return next})}>{t('Use shared settings')}</button>}
      </article>})}</div>
    {repeated&&<p role="alert" className={styles.warning}>{t('Two selected VMs would use the same destination name. Rename one of them or change its destination.')}</p>}
    {review&&<div className={styles.flags}>{!!originals.length&&<label><input type="checkbox" checked={confirmReplace} onChange={e=>setConfirmReplace(e.target.checked)}/>{t('Allow the listed recoveries to replace existing VMs at their original locations.')}</label>}
      {!!flagged.length&&<label><input type="checkbox" checked={confirmFlags} onChange={e=>setConfirmFlags(e.target.checked)}/>{t('I have reviewed the reported malware status.')}</label>}</div>}
    {error&&<p role="alert" className={styles.warning}>{error}</p>}
    <div className={styles.actions}><Button variant="outline" onClick={()=>review?edit():onBack()}><ArrowLeft size={14}/>{t('Back')}</Button>
      <Button disabled={!valid||(review&&((originals.length>0&&!confirmReplace)||(flagged.length>0&&!confirmFlags)))} onClick={()=>review?void start():setReview(true)}>
        {busy?t('Submitting…'):review?t('Start {count} recoveries',{count:formatNumber(vms.length)}):t('Review batch')}<ArrowRight size={14}/></Button></div>
  </fieldset></>
}
