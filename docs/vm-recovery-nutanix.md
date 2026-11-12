# Nutanix AHV recovery from a VM restore point

The Nutanix plug-in contributes **Entire VM restore** and **Instant Recovery** to the VBR Backups menu. Its operations are evaluated separately from the point's VBR `allowedOperations`. For a VMware backup, keep the selected calendar point's VBR restore-point ID throughout either workflow.

## Connection and eligibility

The plug-in API root is `https://<VBR-web-host>/extension/799a5a3e-ae1e-4eaf-86eb-8a9acc2670e2/api/v10`. Its public endpoints accept the VBR REST bearer. The installed extension served its v10 OpenAPI definition at `/extension/799a5a3e-ae1e-4eaf-86eb-8a9acc2670e2/swagger/v10/swagger.json`. The endpoint paths below are relative to the plug-in API root unless prefixed with `/private-api`. [Veeam AHV API connection and authorization](https://helpcenter.veeam.com/references/vbahv/10/rest/tag/SectionOverview/index.html)

The installed `Nutanix AHV/Service/wwwroot/plugin/plugin.js` registers `AhvInstantRecovery` and `AhvRestoreEntireVm`. It checks the user's corresponding AHV restore permission, a supported source platform, retained points and the backup object's type. It evaluates restore-scoped inventory and the original-location permission. The inspected console implementation excludes tenant backup objects here. The target picker also counts AHV clusters with restore permissions. The supported source-platform list includes VMware, Hyper-V, Nutanix, Proxmox, Windows physical, Linux physical and custom platforms.

## Calls used to prepare the destination

| Method and endpoint | Purpose |
| --- | --- |
| `GET /inventory` | Inspect restore-scoped VM inventory and eligible clusters. Use the plug-in filters for object type, permissions and paging. |
| `POST /restorePoints/resolveObjectTag` | Resolve source-object references when the workflow starts with a backup object. The wizard sends a map keyed by its own item IDs. |
| `GET /restorePoints/{id}/metadata` | Read backed-up VM identity, disks, adapters and network metadata for the chosen point. |
| `POST /restorePoints/checkRestoreTarget` | Check the original AHV target when applicable. The console builds a keyed map with `restorePointId` and optional `sourceVmId`. |
| `GET /clusters`, `GET /clusters/{id}/vms` | Discover registered destinations and inspect VMs on the selected cluster. |
| `GET /clusters/{id}/storageContainers`, `GET /clusters/{id}/networks` | Populate storage and networking choices with AHV identifiers. The client also defines `POST /clusters/storageContainersByClusterBatch` and `POST /clusters/networksByClusterBatch` for multiple clusters. |

## Submit and follow the session

| Operation | Installed console client | Published v10 contract |
| --- | --- | --- |
| Entire VM restore | `POST /restorePoints/multiRestore` with an array of VM settings. Each result can include `sessionId`. | `POST /restorePoints/restore` with one settings object. HTTP 202 returns `sessionId`. |
| Instant VM Recovery | `POST /multiInstantRecovery` with settings keyed by zero-based index. Extract each `result.sessionId`. The client also defines `POST /instantRecovery` for a single VM. | The local public v10 OpenAPI definition omits these operations. |
| Inspect and stop publication | `GET /instantRecovery/sessions/{id}`, `POST /instantRecovery/sessions/{id}/stop`. The console supports `POST /instantRecovery/sessions/multiStop` with an array of plug-in session IDs. | Console client contract. |
| Start production migration | `POST /instantRecovery/sessions/{id}/startMigration`. The console sends `POST /instantRecovery/sessions/multiStartMigration` with an array of plug-in session IDs. | Console client contract. |
| Inspect or stop a migration | `GET /instantRecovery/migrations/{id}`, `POST /instantRecovery/migrations/{id}/stop`, `POST /instantRecovery/migrations/multiStop`. | Console client contract. |
| Open the VBR activity record | `GET /private-api/v1/sessions?tagFilter={pluginSessionId}&orderColumn=CreationTime&orderAsc=false&limit=1` on the **VBR web origin**. Use the returned VBR record's `id` for the session details. | The native wizard uses this lookup. The plug-in session and VBR history IDs can differ. |

For a full restore to a new location, select an AHV `targetVmClusterId`, `targetVmName`, `storageContainerId` and per-adapter mapping. Supply `restorePointId`, `restoreToOriginal`, `powerOnVmAfterRestore`, `reason` and `restoreVmCategories` according to the choices. Connected adapter mappings carry `originalMacAddress` and `value` with AHV network settings. The console also tracks `disconnectNetworksAfterRestore`. [Veeam AHV full restore request](https://helpcenter.veeam.com/references/vbahv/10/rest/tag/RestorePoints/index.html)

Instant Recovery uses a per-disk `diskSettings` list with the source disk ID, bus type, index and destination storage container. The console supplies `targetVmClusterId`, `targetVmId`, `targetVmName`, `restoreToOriginal`, `restorePointId`, `sourceVmName`, network and power options, optional reason and categories. An original-location overwrite sets `forceDeleteExistingVm`. Migration commits changes made since mounting to production storage. Stopping publication discards them. [Veeam AHV Instant Recovery workflow](https://helpcenter.veeam.com/docs/vbr/userguide/ahv_instant_recovery_ahv_web.html)

## Result on the inspected installation

Authenticated read-only requests to `GET /clusters?limit=1` and `GET /inventory?veeamRbacScope=Restore&limit=0` returned HTTP 200. The latter reported `totalCount: 0`. For the selected VMware point, the native Instant Recovery wizard required a new location and reported that restoring to a new location was impossible. No eligible target was available to validate a final payload. Open Backup UI leaves AHV launch and AHV mount mutations unavailable on this branch. The Sessions list can display AHV sessions returned by VBR. Verification covered the installed console and API contracts and live reads. No AHV recovery or migration was executed.
