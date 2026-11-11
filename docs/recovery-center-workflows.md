# Recovery Center

Start with what you need back: an entire workload, individual files or objects, application items, or disks and volumes. The source list uses the connected account's inventory and recovery permissions. A bucket used to *store* a backup does not make its contents an object-storage backup.

Choose the workload on the left and a restore time on the right. The calendar keeps points from the same day separate and lets you jump by month and year. The next step offers only the methods available for that point. Application recovery also checks the application recorded for the backup object. Only Instant VM Recovery and Entire VM Restore accept a group of VMs.

| Source | Workflows |
| --- | --- |
| File shares and file servers | Browse, search and restore selected files or versions; restore the entire source; roll back the original location. Instant share publishing, migration and switchover appear when VBR makes them available. |
| Object-storage sources | Browse versions, recover selected objects, restore the entire backed-up source, or roll back. VBR inventory supplies eligible destination servers. |
| Windows physical computers | Guest files, supported application items, Instant Recovery to a VM and disk publishing where reported. Volume recovery uses a connected recovery appliance. Recovery media and time-limited access tokens are offered only for eligible computer backups. |
| Virtual machines | VM, guest file, application and disk restore options depend on the platform, the point, and the current VBR account. |

The application rechecks the backup, source and restore point before launching. Some VBR builds return sibling shares' points to an object-scoped request. When a backup contains several shares and VBR cannot establish historical point ownership, Recovery Center offers only a point explicitly linked to that share. It never matches on the share name or timestamp.

**Session navigation.** Recovery Center and Protected Data open the resulting recovery under Recovery Center. Sessions retains its own return path for the same native session. An application launch has a source- and account-scoped request ID. Reloading checks its receipt without repeating the start. A browser error on an older request without a receipt does not create another VBR session row.

**Active Directory.** In the mounted directory, select objects and use Restore, Export and the recovery cart above the grid. The cart holds items from different folders in the same browse session. Browse attributes and search by name or LDAP filter through VBR. Restore and export use VBR's native validation and operation workflows.

**Volume recovery.** Boot and verify the destination recovery appliance before mapping disks. Review VBR's source, destination and proposed mappings; if needed, stage a different source/destination disk pair. A disk write requires the target computer name and a final native layout check. Media generation produces a downloadable ISO; creating a recovery token grants temporary access to the displayed backup chain. Neither operation starts a volume restore.

For VM-specific request schemas and endpoint details, see [VM restore API map](vm-restore-api.md).
