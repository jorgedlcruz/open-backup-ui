# VM restore API map

This map covers backup restore points in VBR 13, REST revision `1.3-rev2`. It follows a VMware VM through the native Backups page, the selected restore point, destination questions, submission, and mounted recovery actions. The tables identify public request and response schemas from the installed `Backup/RestApiService/specs/latest/swagger.json`. Console route names and HTTP methods come from the installed BackupWebUI client. The separate Explorer and Nutanix sections cover options that appear at the VM level.

## Starting from the calendar

Keep the exact object, backup, and restore-point IDs when a user chooses a timestamp. More than one point can exist on a day. Fetch the point again before submission and use its `allowedOperations`. The captured VMware point returned five values. The table gives the smallest set of decisions needed to reach each endpoint. [VBR restore reference](https://helpcenter.veeam.com/references/vbr/13/rest/1.3-rev2/tag/Restore/index.html)

| Allowed operation | Operator decisions | Public submission |
| --- | --- | --- |
| `StartViVMInstantRecovery` | Original or new location. For a new location, enter the recovered VM name and select the host. Optionally change folder, resource pool and write-cache datastore. Review networking, power and overwrite before publishing. | `POST /api/v1/restore/instantRecovery/vSphere/vm` |
| `StartEntireVmRestore` | Original location supports quick rollback. A customized restore can change name, host, resource pool, folder, datastore and networks. Review power, proxy and secure restore settings. | `POST /api/v1/restore/vmRestore/vSphere` |
| `StartHvVMInstantRecovery` | A VMware source needs a Hyper-V destination. Select the host, recovered name and storage placement. Use the cross-platform discriminator. | `POST /api/v1/restore/instantRecovery/hyperV/vm` |
| `StartFCDInstantRecovery` | Select the destination cluster and backed-up disks. Supply each disk’s name in the backup, mount name and registered First Class Disk name. | `POST /api/v1/restore/instantRecovery/vSphere/fcd` |
| `StartFlrRestore` | Select Windows or Linux mount settings for this point. After mount, browse the filesystem, select paths, choose a destination and collision policy, track the file task, then unmount. | `POST /api/v1/restore/flr` |

Other backups can advertise `StartEntireVmRestoreHyperV`, `StartEntireVmRestoreCloudDirector` and `StartDiskPublish`. Replica failover and failback have separate operation families. Use VBR’s restore-point capabilities to decide which launch controls to show.

## What the native console does

1. On the VM’s object page the console requests `GET /private-api/v1/restorePoints` with `backupObjectIdFilter`, `backupIdFilter`, `skip` and `limit`. The supplied capture uses a one-record look-up followed by a page of up to 1,000. The Open Backup UI calendar already has the chosen ID.
2. For instant VMware recovery the console posts `{"restoreItems":[{"pointId":"<point>","backupId":"<backup>"}],"interaction":[]}` to `/private-api/v1/restore/instantRecovery/vSphere/checkVmwareInstantRecoverySourceItems`. In customized mode it posts `{"mode":"Customized","objects":[{"restorePointId":"<point>"}]}` to `resolveBatchDefaults` under the same prefix. Private validation responses can ask the operator a question. Each follow-up response belongs to that validation request.
3. Browse the permitted target inventory with `POST /api/v1/inventory` followed by `POST /api/v1/inventory/{hostname}`. Set `permissionScope` to `Restore`, choose a hierarchy for the object type, and pass the platform predicate. Reuse the returned inventory identity, including its native object ID and server. Names alone are ambiguous across vCenters.
4. In the VMware full-restore wizard the name editor is on the Folder page, behind VM selection and **Name**. With a distinct name, the live wizard continued to Network, Reason and Summary. With a colliding name, VMware instant recovery asked for overwrite consent. Open Backup UI places the editable name with the destination and reviews it before launch.
5. Submit once. VM and disk recovery normally return a session ID. FLR returns a browse mount with a `sessionId`, and a file restore returns a task ID. For a mounted instant VM the public mount’s `id` is the argument to migrate or unmount. Its separate `sessionId` links the mount to history and logs. After an ambiguous upstream response, check Activity before another submission.

The Web UI authenticates its private requests with its own session. Open Backup UI submits through the configured VBR REST connection with its existing bearer credentials. The console’s private validation routes and cookies are not portable to the REST listener. The API map includes provider functionality beyond the controls implemented in this branch.

## A customized instant VM request

This illustrative wire shape uses placeholders for a point and a host discovered through inventory. Optional folder and resource-pool fields accept their own returned inventory objects. Enable write redirection and supply a cache datastore together when requested.

```json
{
  "restorePointId": "<selected-restore-point-uuid>",
  "type": "Customized",
  "destination": {
    "restoredVmName": "directory-recovered",
    "destinationHost": {
      "platform": "VSphere",
      "type": "Host",
      "hostName": "<inventory-server>",
      "name": "<esxi-host>",
      "objectId": "<native-host-id>",
      "urn": "<native-host-urn>"
    },
    "biosUuidPolicy": "GenerateNew",
    "enableClusterWideMount": false
  },
  "datastore": { "redirectEnabled": false },
  "secureRestore": { "antivirusScanEnabled": false, "yaraScanEnabled": false },
  "vmTagsRestoreEnabled": true,
  "nicsEnabled": false,
  "powerUp": false,
  "overwrite": false,
  "reason": "Recover a separate copy for verification"
}
```

## Payloads for the other paths

Use the full native objects returned by the lookup routes in the tables below. The field paths in this table identify where those objects belong in the final JSON. The five-point walkthrough used VMware source data. Required fields for another source or discriminator are defined by the corresponding schema in the installed OpenAPI file.

| Flow | Body construction |
| --- | --- |
| Full VMware, original | Send `restorePointId`, `type: OriginalLocation`, power and secure-restore settings. An operator who selects changed blocks sets `quickRollback`. |
| Full VMware, customized | Send `type: Customized`, `destinationHost`, optional `resourcePool`, and `folder: {vmName, folder, restoreVmTags}`. Set `datastore.defaultDatastore` for a new datastore. Source and target networks are inventory references. A guest adapter ID from `networkInfo` is insufficient to identify a distributed port group. |
| Instant Hyper-V from VMware | Set `type: OtherPlatform` and supply the restore-scoped `destinationHost`. Put the recovered name in `target.vmName` and the storage directory in `datastore.configurationFilesPath`. An original-location Hyper-V restore uses its own discriminator. |
| First Class Disk | Send `{restorePointId, destinationCluster, disksMapping, reason}`. Each mapping contains `nameInBackup`, `mountedDiskName` and `registeredFcdName`. Optional `writeCache` describes cache redirection. |
| Windows file restore | Send `{restorePointId, type: "Windows", mountMode: "Automatic", autoUnmount: {isEnabled: true, noActivityPeriodInMinutes: 30}}`. Use the returned `sessionId` to browse. Linux manual mounting additionally requires a selected mount server. |
| Restore selected guest items | Browse a directory with `{path, pagination, order}`. Validate guest credentials before posting `{sourcePath, restoreType, credentialsId}` to `restore`. An alternate host uses `restoreTo` with `targetHost` and `targetPath`. Poll the returned task ID using `GET /api/v1/tasks/{id}`. |
| Disk publish | The branch uses `{restorePointId, type: "ISCSITarget", diskNames, allowedIps, reason}`. VBR also defines Windows iSCSI mount and Linux FUSE mount modes. |
| Cloud Director | The branch offers original-location recovery for an eligible Cloud Director point. The public customized spec also defines a target vApp, name, datastore and network in the Cloud Director inventory. |

The branch's [payload builders](../lib/recovery/start.ts), [network resolution](../lib/recovery/networks.ts) and [guest file operations](../lib/recovery/files.ts) implement the transitions. The tables below include additional cataloged options such as file download, search and comparison. [VBR Backup Browser reference](https://helpcenter.veeam.com/references/vbr/13/rest/1.3-rev2/tag/Backup-Browser/index.html)


## Source, inventory and shared settings

| Method | Public REST path | Request body | Success response |
| --- | --- | --- | --- |
| GET | `/api/v1/backupInfrastructure/mountServers` | — | MountServerModelsResult |
| GET | `/api/v1/backupInfrastructure/mountServers/default` | — | MountServerModelsResult |
| GET | `/api/v1/backupInfrastructure/mountServers/{id}` | — | MountServerModel |
| GET | `/api/v1/backupInfrastructure/proxies` | — | ProxiesResult |
| GET | `/api/v1/backupObjects/{id}` | — | BackupObjectModel |
| GET | `/api/v1/backupObjects/{id}/restorePoints` | — | ObjectRestorePointsResult |
| GET | `/api/v1/backups/{id}/objects` | — | BackupObjectsResult |
| GET | `/api/v1/credentials` | — | CredentialsResult |
| POST | `/api/v1/inventory` | InventoryBrowserFilters | InventoryBrowserResult |
| POST | `/api/v1/inventory/retrieveMachineDetails` | InventoryMachineDetailsRequest | InventoryMachineDetailsModel |
| POST | `/api/v1/inventory/{hostname}` | InventoryBrowserFilters | InventoryBrowserResult |
| GET | `/api/v1/malwareDetection/yaraRules` | — | YaraRulesResult |
| GET | `/api/v1/restorePoints` | — | ObjectRestorePointsResult |
| GET | `/api/v1/restorePoints/{id}` | — | ObjectRestorePointModel |
| GET | `/api/v1/restorePoints/{id}/disks` | — | ObjectRestorePointDisksResult |
| POST | `/api/v1/restorePoints/{id}/networkInfo` | FlexibleFilters | ObjectRestorePointNetworkInfoResult |
| GET | `/api/v1/security/restoreOptions` | — | RestoreOptionsResult |

Console client routes for this workflow.

| Method | Console path |
| --- | --- |
| GET | `/private-api/v1/backups` |
| POST | `/private-api/v1/backups/objects` |
| GET | `/private-api/v1/backups/{id}` |
| GET | `/private-api/v1/backups/{id}/objects` |
| POST | `/private-api/v1/restore/checkTargetHostFsPath` |
| POST | `/private-api/v1/restore/validation/checkRestoreReason` |
| POST | `/private-api/v1/restore/validation/checkSecureRestoreSpec` |
| GET | `/private-api/v1/restorePoints` |
| GET | `/private-api/v1/restorePoints/{id}` |

## VMware entire VM and instant recovery

| Method | Public REST path | Request body | Success response |
| --- | --- | --- | --- |
| GET | `/api/v1/restore/instantRecovery/vSphere/vm` | — | InstantViVMRecoveryMountsResult |
| POST | `/api/v1/restore/instantRecovery/vSphere/vm` | InstantViVMRecoverySpec | SessionModel |
| GET | `/api/v1/restore/instantRecovery/vSphere/vm/{mountId}` | — | InstantViVMRecoveryMount |
| POST | `/api/v1/restore/instantRecovery/vSphere/vm/{mountId}/migrate` | ViVMQuickMigrationSpec | SessionModel |
| POST | `/api/v1/restore/instantRecovery/vSphere/vm/{mountId}/unmount` | — | SessionModel |
| POST | `/api/v1/restore/vmRestore/vSphere` | EntireViVMRestoreSpec | SessionModel |

Console client routes for this workflow.

| Method | Console path |
| --- | --- |
| POST | `/private-api/v1/restore/instantRecovery/vSphere/checkVmwareInstantRecoveryDatastore` |
| POST | `/private-api/v1/restore/instantRecovery/vSphere/checkVmwareInstantRecoveryFolder` |
| POST | `/private-api/v1/restore/instantRecovery/vSphere/checkVmwareInstantRecoveryHelperAppliance` |
| POST | `/private-api/v1/restore/instantRecovery/vSphere/checkVmwareInstantRecoveryHost` |
| POST | `/private-api/v1/restore/instantRecovery/vSphere/checkVmwareInstantRecoveryMode` |
| POST | `/private-api/v1/restore/instantRecovery/vSphere/checkVmwareInstantRecoverySourceItems` |
| POST | `/private-api/v1/restore/instantRecovery/vSphere/checkVmwareInstantRecoverySpec` |
| POST | `/private-api/v1/restore/instantRecovery/vSphere/resolveBatchDefaults` |
| POST | `/private-api/v1/restore/validation/checkVmwareEntireVmRestoreDatastore` |
| POST | `/private-api/v1/restore/validation/checkVmwareEntireVmRestoreFolder` |
| POST | `/private-api/v1/restore/validation/checkVmwareEntireVmRestoreHost` |
| POST | `/private-api/v1/restore/validation/checkVmwareEntireVmRestoreMode` |
| POST | `/private-api/v1/restore/validation/checkVmwareEntireVmRestoreSourceItems` |
| POST | `/private-api/v1/restore/validation/checkVmwareEntireVmRestoreSpec` |
| POST | `/private-api/v1/restore/vmRestore/vSphere/resolveBatchDefaults` |
| POST | `/private-api/v1/restore/vmRestore/vSphere/resolveDefaults` |

## Hyper-V entire VM and instant recovery

| Method | Public REST path | Request body | Success response |
| --- | --- | --- | --- |
| GET | `/api/v1/restore/instantRecovery/hyperV/vm` | — | InstantHvVMRecoveryMountsResult |
| POST | `/api/v1/restore/instantRecovery/hyperV/vm` | InstantHvVMRecoverySpec | SessionModel |
| GET | `/api/v1/restore/instantRecovery/hyperV/vm/{mountId}` | — | InstantHvVMRecoveryMount |
| POST | `/api/v1/restore/instantRecovery/hyperV/vm/{mountId}/migrate` | — | — |
| POST | `/api/v1/restore/instantRecovery/hyperV/vm/{mountId}/unmount` | — | SessionModel |
| POST | `/api/v1/restore/vmRestore/hyperV` | EntireHvVMRestoreSpec | SessionModel |

Console client routes for this workflow.

| Method | Console path |
| --- | --- |
| POST | `/private-api/v1/restore/instantRecovery/hyperV/checkHyperVInstantRecoveryAppliance` |
| POST | `/private-api/v1/restore/instantRecovery/hyperV/checkHyperVInstantRecoveryDatastore` |
| POST | `/private-api/v1/restore/instantRecovery/hyperV/checkHyperVInstantRecoveryHost` |
| POST | `/private-api/v1/restore/instantRecovery/hyperV/checkHyperVInstantRecoveryMode` |
| POST | `/private-api/v1/restore/instantRecovery/hyperV/checkHyperVInstantRecoveryName` |
| POST | `/private-api/v1/restore/instantRecovery/hyperV/checkHyperVInstantRecoverySourceItems` |
| POST | `/private-api/v1/restore/instantRecovery/hyperV/checkHyperVInstantRecoveryVms` |
| POST | `/private-api/v1/restore/instantRecovery/hyperV/resolveDefaults` |
| POST | `/private-api/v1/restore/validation/checkHyperVEntireVmRestoreDatastore` |
| POST | `/private-api/v1/restore/validation/checkHyperVEntireVmRestoreHost` |
| POST | `/private-api/v1/restore/validation/checkHyperVEntireVmRestoreMode` |
| POST | `/private-api/v1/restore/validation/checkHyperVEntireVmRestoreName` |
| POST | `/private-api/v1/restore/validation/checkHyperVEntireVmRestoreSourceItems` |
| POST | `/private-api/v1/restore/validation/checkHyperVEntireVmRestoreVms` |
| POST | `/private-api/v1/restore/vmRestore/hyperV/resolveDefaults` |

## Cloud Director, First Class Disk and disk publishing

| Method | Public REST path | Request body | Success response |
| --- | --- | --- | --- |
| GET | `/api/v1/dataIntegration` | — | BackupContentMountsResult |
| POST | `/api/v1/dataIntegration/publish` | PublishBackupContentSpec | SessionModel |
| GET | `/api/v1/dataIntegration/{mountId}` | — | BackupContentMountModel |
| POST | `/api/v1/dataIntegration/{mountId}/unpublish` | — | SessionModel |
| GET | `/api/v1/restore/instantRecovery/vSphere/fcd` | — | VmwareFcdInstantRecoveryMountsResult |
| POST | `/api/v1/restore/instantRecovery/vSphere/fcd` | VmwareFcdInstantRecoverySpec | SessionModel |
| GET | `/api/v1/restore/instantRecovery/vSphere/fcd/{mountId}` | — | VmwareFcdInstantRecoveryMount |
| POST | `/api/v1/restore/instantRecovery/vSphere/fcd/{mountId}/dismount` | — | SessionModel |
| POST | `/api/v1/restore/instantRecovery/vSphere/fcd/{mountId}/migrate` | VmwareFcdQuickMigrationSpec | SessionModel |
| POST | `/api/v1/restore/vmRestore/cloudDirector` | EntireCloudDirectorVMRestoreSpec | SessionModel |

Console client routes for this workflow.

| Method | Console path |
| --- | --- |
| POST | `/private-api/v1/restore/diskPublish` |
| GET | `/private-api/v1/restore/diskPublish/disks` |
| POST | `/private-api/v1/restore/diskPublish/targets` |
| POST | `/private-api/v1/restore/diskPublish/validation/restorePoint` |
| POST | `/private-api/v1/restore/diskPublish/validation/targets` |

## Guest file recovery

| Method | Public REST path | Request body | Success response |
| --- | --- | --- | --- |
| GET | `/api/v1/backupBrowser/flr` | — | FlrBrowseMountResult |
| GET | `/api/v1/backupBrowser/flr/{sessionId}` | — | FlrBrowseMountModel |
| GET | `/api/v1/backupBrowser/flr/{sessionId}/audit` | — | FlrAuditMountModel |
| POST | `/api/v1/backupBrowser/flr/{sessionId}/browse` | FlrBrowseFolderSpec | FlrBrowseFolderModel |
| POST | `/api/v1/backupBrowser/flr/{sessionId}/compareAttributes` | FlrCompareAttributesSpec | FlrCompareAttributesModel |
| POST | `/api/v1/backupBrowser/flr/{sessionId}/compareToProduction` | FlrCompareToProductionSpec | EmptySuccessResponse |
| POST | `/api/v1/backupBrowser/flr/{sessionId}/prepareDownload` | FlrStartDownloadSpec | TaskModel |
| GET | `/api/v1/backupBrowser/flr/{sessionId}/prepareDownload/{taskId}/download` | — | binary |
| POST | `/api/v1/backupBrowser/flr/{sessionId}/prepareDownload/{taskId}/download` | — | binary |
| POST | `/api/v1/backupBrowser/flr/{sessionId}/restore` | FlrRestoreSpec | TaskModel |
| POST | `/api/v1/backupBrowser/flr/{sessionId}/restoreTo` | FlrRestoreToSpec | TaskModel |
| POST | `/api/v1/backupBrowser/flr/{sessionId}/search` | FlrStartSearchForSpec | TaskModel |
| POST | `/api/v1/backupBrowser/flr/{sessionId}/search/{taskId}/browse` | FlrSearchForResultSpec | FlrSearchForResultModel |
| POST | `/api/v1/restore/flr` | FlrMountSpec | FlrBrowseMountModel |
| POST | `/api/v1/restore/flr/{sessionId}/unmount` | — | SessionModel |
| POST | `/api/v1/restore/flr/{sessionId}/validateCredentials` | FlrRestoreCredentialsValidationSpec | FlrRestoreCredentialsValidationResult |
| POST | `/api/v1/restore/flr/{sessionId}/validateRestoreItemTargetPath` | FlrValidateRestoreItemTargetPathSpec | FlrValidateRestoreItemTargetPathResult |
| GET | `/api/v1/tasks/{id}` | — | TaskModel |
| POST | `/api/v1/tasks/{id}/stop` | — | EmptySuccessResponse |

Console client routes for this workflow.

| Method | Console path |
| --- | --- |
| POST | `/private-api/v1/flr/validation/actionsAvailability` |
| POST | `/private-api/v1/flr/validation/mountServer/autoselect` |
| POST | `/private-api/v1/flr/validation/mountServer/prepareSpec` |
| POST | `/private-api/v1/flr/validation/mountServer/select` |
| POST | `/private-api/v1/flr/validation/originalMountServer` |
| POST | `/private-api/v1/flr/validation/restoreItem/targetPath` |
| POST | `/private-api/v1/flr/validation/restorePoint` |
| GET | `/private-api/v1/flr/validation/{backupObjectId}/audit` |

## Activity and mounted recovery

| Method | Public REST path | Request body | Success response |
| --- | --- | --- | --- |
| GET | `/api/v1/sessions` | — | SessionsResult |
| GET | `/api/v1/sessions/{id}` | — | SessionModel |
| GET | `/api/v1/sessions/{id}/logs` | — | SessionLogResult |
| POST | `/api/v1/sessions/{id}/stop` | — | EmptySuccessResponse |
| GET | `/api/v1/sessions/{id}/taskSessions` | — | TaskSessionsResult |
| GET | `/api/v1/taskSessions/{id}` | — | TaskSessionModel |
| GET | `/api/v1/taskSessions/{id}/logs` | — | SessionLogResult |

Console client routes for this workflow.

| Method | Console path |
| --- | --- |
| GET | `/private-api/v1/metrics/restoreCounters/{sessionId}` |
| POST | `/private-api/v1/restore/instantRecovery/hyperv/vm/{mountId}/retry` |
| POST | `/private-api/v1/restore/instantRecovery/sessions` |
| POST | `/private-api/v1/restore/instantRecovery/vSphere/vm/migrate` |
| POST | `/private-api/v1/restore/instantRecovery/vSphere/vm/migrate/defaults` |
| POST | `/private-api/v1/restore/validation/checkVmwareQuickMigrationDestination` |
| POST | `/private-api/v1/restore/validation/checkVmwareQuickMigrationOptions` |
| POST | `/private-api/v1/restore/validation/checkVmwareQuickMigrationSourceItems` |
| GET | `/private-api/v1/sessions` |

The native history capture uses `GET /private-api/v1/sessions` with a time window, pagination, sorting and repeated `excludeTypeFilter` values. Its mounted-recovery list uses **POST** to `/private-api/v1/restore/instantRecovery/sessions` with paging and repeated `targetPlatform` query parameters. Public per-platform lists use **GET**. An older running mount can outlive the history window. Keep it visible until VBR reports its removal.

Quick Migration has its own destination and transfer settings. The live published VM exposed **Properties**, **Migrate to Production**, and **Stop Publishing**. Properties showed session details. A single-VM public migration uses the mount ID in the URL and a `ViVMQuickMigrationSpec` with target inventory and datastore settings. The native batch workflow first resolves defaults using `{"objects":[{"mountId":"<mount>"}]}`. FCD uses `dismount`, published disk content uses `unpublish`, and a guest mount uses its FLR session ID for `unmount`.

## Application-aware and plug-in actions

On the inspected domain controller, the object menu additionally exposed **Application Items → Microsoft Active Directory**. The console opens `/explorer/microsoft-ad/browse?backupId=…&backupObjectId=…` in a separate tab. The installed router accepts a `restorePointId` query parameter. The inspected Explorer reported **Not found** before a browse session started. Object-level Explorer capability and the chosen point’s five public VM operations come from different models. This branch catalogs the Explorer endpoints and leaves application-item recovery in Veeam Explorer.

The Nutanix plug-in added an AHV destination to both native VM menus. In both wizards the VMware source forced a new location, and the plug-in rejected that mode on this installation. See the [Nutanix endpoints and target availability](vm-recovery-nutanix.md).


## Installed Explorer client endpoints

| Method | Public REST path | Request body | Success response |
| --- | --- | --- | --- |
| GET | `/api/v1/restore/applicationItems/{browseSessionId}/childSessions` | — | SessionsResult |

Console client routes for this workflow.

| Method | Console path |
| --- | --- |
| POST | `/api/v1/backupBrowser/applicationItems/vead` |
| POST | `/api/v1/backupBrowser/applicationItems/vead/{browseSessionId}` |
| GET | `/api/v1/backupBrowser/applicationItems/vead/{browseSessionId}/{taskId}/result` |
| GET | `/api/v1/backupBrowser/applicationItems/vead/{taskId}/result` |
| GET | `/api/v1/restore/applicationItems/vead` |
| POST | `/api/v1/restore/applicationItems/vead/{browseSessionId}/keepAlive` |
| POST | `/api/v1/restore/applicationItems/vead/{browseSessionId}/start` |
| GET | `/api/v1/restore/applicationItems/vead/{restoreModelId}` |
| GET | `/api/v1/restore/applicationItems/vead/{restoreModelId}/actionLogItems` |
| POST | `/api/v1/restore/applicationItems/vead/{restoreModelId}/stop` |
| GET | `/api/v1/restore/applicationItems/{browseSessionId}/childSessions` |
| POST | `/private-api/v1/applicationItems/operations` |
| POST | `/private-api/v1/applicationItems/operations/stop` |
| POST | `/private-api/v1/applicationItems/sessions/{sessionId}/close` |
| POST | `/private-api/v1/backupBrowser/applicationItems/vead` |
| POST | `/private-api/v1/backupBrowser/applicationItems/vead/{browseSessionId}` |
| POST | `/private-api/v1/backupBrowser/applicationItems/vead/{browseSessionId}/keepAlive` |
| GET | `/private-api/v1/backupBrowser/applicationItems/vead/{browseSessionId}/{taskId}/result` |
| GET | `/private-api/v1/backupBrowser/applicationItems/vead/{taskId}/result` |
| POST | `/private-api/v1/backupBrowser/applicationItems/veor` |
| POST | `/private-api/v1/backupBrowser/applicationItems/veor/{browseSessionId}` |
| POST | `/private-api/v1/backupBrowser/applicationItems/veor/{browseSessionId}/close` |
| POST | `/private-api/v1/backupBrowser/applicationItems/veor/{browseSessionId}/keepAlive` |
| GET | `/private-api/v1/backupBrowser/applicationItems/veor/{browseSessionId}/{taskId}/result` |
| GET | `/private-api/v1/backupBrowser/applicationItems/veor/{taskId}/result` |
| POST | `/private-api/v1/backupBrowser/applicationItems/vepg` |
| POST | `/private-api/v1/backupBrowser/applicationItems/vepg/{browseSessionId}` |
| POST | `/private-api/v1/backupBrowser/applicationItems/vepg/{browseSessionId}/close` |
| POST | `/private-api/v1/backupBrowser/applicationItems/vepg/{browseSessionId}/keepAlive` |
| GET | `/private-api/v1/backupBrowser/applicationItems/vepg/{browseSessionId}/{taskId}/result` |
| GET | `/private-api/v1/backupBrowser/applicationItems/vepg/{taskId}/result` |
| POST | `/private-api/v1/backupBrowser/applicationItems/vesql` |
| POST | `/private-api/v1/backupBrowser/applicationItems/vesql/{browseSessionId}` |
| GET | `/private-api/v1/backupBrowser/applicationItems/vesql/{browseSessionId}/{taskId}/result` |
| GET | `/private-api/v1/backupBrowser/applicationItems/vesql/{taskId}/result` |
| POST | `/private-api/v1/export/applicationItems/vead/{browseSessionId}/init` |
| POST | `/private-api/v1/export/applicationItems/vead/{exportSessionId}/start` |
| POST | `/private-api/v1/export/applicationItems/vesql/{browseSessionId}/init` |
| POST | `/private-api/v1/export/applicationItems/vesql/{permanentSessionId}/pointInTime` |
| POST | `/private-api/v1/export/applicationItems/vesql/{permanentSessionId}/start` |
| POST | `/private-api/v1/exportPublishedDatabase/applicationItems/vesql/{permanentSessionId}/start` |
| POST | `/private-api/v1/instantRecovery/applicationItems/vesql/{browseSessionId}/init` |
| POST | `/private-api/v1/instantRecovery/applicationItems/vesql/{permanentSessionId}/edit` |
| POST | `/private-api/v1/instantRecovery/applicationItems/vesql/{permanentSessionId}/start` |
| POST | `/private-api/v1/instantRecovery/applicationItems/vesql/{permanentSessionId}/switchover` |
| POST | `/private-api/v1/publish/applicationItems/vesql/{browseSessionId}/init` |
| POST | `/private-api/v1/publish/applicationItems/vesql/{publishSessionId}/initPublishedDatabaseExport` |
| POST | `/private-api/v1/publish/applicationItems/vesql/{publishSessionId}/start` |
| POST | `/private-api/v1/restore/applicationItems/vead/{browseSessionId}/init` |
| POST | `/private-api/v1/restore/applicationItems/vead/{restoreSessionId}/start` |
| POST | `/private-api/v1/restore/applicationItems/veor/{browseSessionId}/init` |
| POST | `/private-api/v1/restore/applicationItems/veor/{permanentSessionId}/start` |
| POST | `/private-api/v1/restore/applicationItems/vepg/{browseSessionId}/init` |
| POST | `/private-api/v1/restore/applicationItems/vepg/{permanentSessionId}/start` |
| POST | `/private-api/v1/restore/applicationItems/vesql/{browseSessionId}/init` |
| POST | `/private-api/v1/restore/applicationItems/vesql/{browseSessionId}/keepAlive` |
| POST | `/private-api/v1/restore/applicationItems/vesql/{permanentSessionId}/start` |
| GET | `/private-api/v1/settings/applicationItems/settings` |
| DELETE | `/private-api/v1/settings/applicationItems/vesql/stagingServer` |
| GET | `/private-api/v1/settings/applicationItems/vesql/stagingServer` |
| POST | `/private-api/v1/settings/applicationItems/vesql/stagingServer` |
| POST | `/private-api/v1/settings/applicationItems/vesql/stagingServer/disable` |
| POST | `/private-api/v1/settings/applicationItems/vesql/stagingServer/enable` |
| POST | `/private-api/v1/settings/applicationItems/vesql/stagingServer/init` |
| GET | `/private-api/v1/settings/applicationItems/vesql/stagingServer/{taskId}/result` |
| GET | `/private-api/v1/validations/applicationItems/tasks/{id}` |
| POST | `/private-api/v1/validations/applicationItems/vead/{exportSessionId}/targetPath` |
| GET | `/private-api/v1/validations/applicationItems/vead/{exportSessionId}/targetPath/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vead/{exportSessionId}/targetWindowsServer` |
| GET | `/private-api/v1/validations/applicationItems/vead/{exportSessionId}/targetWindowsServer/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vead/{restoreSessionId}/adminShareAndSam` |
| GET | `/private-api/v1/validations/applicationItems/vead/{restoreSessionId}/adminShareAndSam/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vead/{restoreSessionId}/attributesForRestore` |
| GET | `/private-api/v1/validations/applicationItems/vead/{restoreSessionId}/attributesForRestore/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vead/{restoreSessionId}/certificate` |
| GET | `/private-api/v1/validations/applicationItems/vead/{restoreSessionId}/certificate/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vead/{restoreSessionId}/credentials` |
| GET | `/private-api/v1/validations/applicationItems/vead/{restoreSessionId}/credentials/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vead/{restoreSessionId}/global-catalog-certificate` |
| POST | `/private-api/v1/validations/applicationItems/vead/{restoreSessionId}/possibleGlobalCatalogs` |
| GET | `/private-api/v1/validations/applicationItems/vead/{restoreSessionId}/possibleGlobalCatalogs/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vead/{restoreSessionId}/possibleRestoreTargets` |
| GET | `/private-api/v1/validations/applicationItems/vead/{restoreSessionId}/possibleRestoreTargets/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vead/{restoreSessionId}/restoreItems` |
| GET | `/private-api/v1/validations/applicationItems/vead/{restoreSessionId}/restoreItems/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vead/{restoreSessionId}/serverContainers` |
| GET | `/private-api/v1/validations/applicationItems/vead/{restoreSessionId}/serverContainers/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vead/{restoreSessionId}/trustCertificate` |
| POST | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/asmAvailable` |
| GET | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/asmAvailable/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/databaseExists` |
| GET | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/databaseExists/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/getOracleHomes` |
| GET | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/getOracleHomes/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/globalDatabaseName` |
| GET | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/globalDatabaseName/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/globalDatabaseNameIsValid` |
| GET | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/globalDatabaseNameIsValid/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/linuxCredentials` |
| GET | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/linuxCredentials/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/mountServerConnection` |
| GET | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/mountServerConnection/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/oracleHome` |
| GET | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/oracleHome/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/oracleHomeUserPassword` |
| GET | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/oracleHomeUserPassword/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/possiblePaths` |
| GET | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/possiblePaths/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/targetDatabasePaths` |
| GET | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/targetDatabasePaths/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/windowsCredentials` |
| GET | `/private-api/v1/validations/applicationItems/veor/{permanentSessionId}/windowsCredentials/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vepg/{permanentSessionId}/credentials` |
| GET | `/private-api/v1/validations/applicationItems/vepg/{permanentSessionId}/credentials/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vepg/{permanentSessionId}/fileWritePermission` |
| GET | `/private-api/v1/validations/applicationItems/vepg/{permanentSessionId}/fileWritePermission/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vepg/{permanentSessionId}/freeSpace` |
| GET | `/private-api/v1/validations/applicationItems/vepg/{permanentSessionId}/freeSpace/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vepg/{permanentSessionId}/installedVersion` |
| GET | `/private-api/v1/validations/applicationItems/vepg/{permanentSessionId}/installedVersion/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vepg/{permanentSessionId}/instanceExists` |
| GET | `/private-api/v1/validations/applicationItems/vepg/{permanentSessionId}/instanceExists/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vepg/{permanentSessionId}/instanceManagementPermission` |
| GET | `/private-api/v1/validations/applicationItems/vepg/{permanentSessionId}/instanceManagementPermission/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vepg/{permanentSessionId}/mountConnection` |
| GET | `/private-api/v1/validations/applicationItems/vepg/{permanentSessionId}/mountConnection/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vepg/{permanentSessionId}/port` |
| GET | `/private-api/v1/validations/applicationItems/vepg/{permanentSessionId}/port/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vepg/{permanentSessionId}/revoke` |
| POST | `/private-api/v1/validations/applicationItems/vepg/{permanentSessionId}/tablespaces` |
| GET | `/private-api/v1/validations/applicationItems/vepg/{permanentSessionId}/tablespaces/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vepg/{permanentSessionId}/userExists` |
| GET | `/private-api/v1/validations/applicationItems/vepg/{permanentSessionId}/userExists/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/adminShareAccess` |
| GET | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/adminShareAccess/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/alwaysOnAndUpdatePrimaryNode` |
| GET | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/alwaysOnAndUpdatePrimaryNode/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/availabilityGroups` |
| GET | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/availabilityGroups/{availabilityGroupName}/nodes` |
| GET | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/availabilityGroups/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/exportDefaultCompressionSetting` |
| GET | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/exportDefaultCompressionSetting/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/exportTargetPath` |
| GET | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/exportTargetPath/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/exportTargetWindowsServer` |
| GET | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/exportTargetWindowsServer/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/fileSystem` |
| GET | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/fileSystem/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/files` |
| GET | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/files/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/filesOnReplicas` |
| GET | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/filesOnReplicas/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/fineTuning/transactions` |
| GET | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/fineTuning/transactions/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/fineTuning/validation` |
| GET | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/fineTuning/validation/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/freeSpace` |
| GET | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/freeSpace/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/guestCredentials` |
| GET | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/guestCredentials/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/mountAccess` |
| GET | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/mountAccess/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/sqlDatabasesDoNotExist` |
| GET | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/sqlDatabasesDoNotExist/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/stagingServerFreeSpaceForExport` |
| GET | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/stagingServerFreeSpaceForExport/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/stagingServerGuestCredentials` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/stagingServerSqlCredentials` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/standByRestoreMode` |
| GET | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/standByRestoreMode/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/targetInstance` |
| GET | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/targetInstance/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/targetInstances` |
| GET | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/targetInstances/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/windowsLogBackups` |
| GET | `/private-api/v1/validations/applicationItems/vesql/{permanentSessionId}/windowsLogBackups/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/vesql/{restoreSessionId}/sqlCredentials` |
| GET | `/private-api/v1/validations/applicationItems/vesql/{restoreSessionId}/sqlCredentials/{taskId}/result` |
| POST | `/private-api/v1/validations/applicationItems/{restoreSessionId}/revoke` |
