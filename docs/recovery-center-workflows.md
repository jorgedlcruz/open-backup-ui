# Recovery Center

Start with what you need back: an entire workload, individual files or objects, application items, or disks and volumes. The source list uses the connected account's inventory and recovery permissions. A bucket used to *store* a backup does not make its contents an object-storage backup.

Choose the workload on the left and a restore time on the right. Its latest eligible restore point is selected automatically, including each VM in a batch. Explicitly selected or linked restore points stay selected when you refresh or browse older history. The calendar keeps points from the same day separate and lets you jump by month and year. The next step offers only the methods available for that point. Application recovery also checks the application recorded for the backup object. Only Instant VM Recovery and Entire VM Restore accept a group of VMs.

**Cached history.** Recovery Center warms the connected account's workload catalog in the background. While the page remains open, it refreshes the catalog and previously visited restore-point histories every 30 minutes. The page's Refresh button performs the same refresh immediately. A new calendar starts with the latest 200 restore points; **Load 200 more restore points** extends the server cache without discarding the selected point. Previously loaded depth is retained on refresh. The in-memory cache is isolated by source, authenticated principal and API revision, and resets when the preview/server restarts. A cold inventory scan still needs VBR; cache entries do not bypass final restore validation. Transient failures identify retained cached data, and authorization failures invalidate it. Calendar history is bounded at 20,000 points and reports when that limit is reached.

| Source | Workflows |
| --- | --- |
| File shares and file servers | Browse, search and restore selected files or versions; restore the entire source; roll back the original location. Instant share publishing, migration and switchover appear when VBR makes them available. |
| Object-storage sources | Browse versions, recover selected objects, restore the entire backed-up source, or roll back. VBR inventory supplies eligible destination servers. |
| Windows physical computers | Guest files, supported application items, Instant Recovery to a VM and disk publishing where reported. Volume recovery uses a connected recovery appliance. Recovery media and time-limited access tokens are offered only for eligible computer backups. |
| Virtual machines | VM, guest file, application and disk restore options depend on the platform, the point, and the current VBR account. |

The application rechecks the backup, source and restore point before launching. Some VBR builds return sibling shares' points to an object-scoped request. When a backup contains several shares and VBR cannot establish historical point ownership, Recovery Center offers only a point explicitly linked to that share. It never matches on the share name or timestamp.

**Session navigation.** Recovery Center and Protected Data open the resulting recovery under Recovery Center. Sessions retains its own return path for the same native session. An application launch has a source- and account-scoped request ID. Reloading checks its receipt without repeating the start. A browser error on an older request without a receipt does not create another VBR session row.

**Active Directory.** In the mounted directory, select objects and use Restore, Export and the recovery cart above the grid. The cart holds items from different folders in the same browse session. Browse attributes and search by name or LDAP filter through VBR. Restore and export use VBR's native validation and operation workflows.

**NAS and object browsing.** Files and folders use the same split layout as guest-file recovery: expand folders on the left, navigate breadcrumbs and select items on the right, and use recovery actions above the grid. Branches load on demand and share the grid's cached directory pages. VBR's native path separators are preserved in requests, including leading-pipe variations. Browse sessions omit the unrelated Workloads tab.

**Copy destinations.** For NAS copy operations, choose a destination server, then browse its live folders and select the destination path. VBR controls the available servers and browse permissions. The temporary inventory browse closes when the folder picker closes or the destination changes; it does not mount a backup or copy files. Changing servers clears the old destination path. Manual paths remain available, including when native folder browsing is unavailable. Copy still requires the final review and submission.

**Explorer startup.** Windows file-lock errors during local receipt replacement are retried briefly. If the request cannot be saved before starting Explorer, Recovery Center reports that Explorer was not started and offers to review the same restore point. If VBR has acknowledged a task, status checks follow that exact task without submitting another start request.

**Loading feedback.** The real operation status is separate from a shuffled collection of 200 playful captions. A small, continuously rotating loading circle appears in front; it has no controls or saved animation preferences. Captions pause while the browser tab is hidden and are excluded from screen-reader announcements.

**Volume recovery.** Boot and verify the destination recovery appliance before mapping disks. Review VBR's source, destination and proposed mappings; if needed, stage a different source/destination disk pair. A disk write requires the target computer name and a final native layout check. Media generation produces a downloadable ISO; creating a recovery token grants temporary access to the displayed backup chain. Neither operation starts a volume restore.

For VM-specific request schemas and endpoint details, see [VM restore API map](vm-restore-api.md).
