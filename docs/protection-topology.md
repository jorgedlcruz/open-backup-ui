# Protection Topology

Open **Veeam Backup & Replication > Protection Topology** (`/vbr/topology`). The page is read-only and uses the selected VBR source or legacy server environment configuration.

## Explore the environment

- Select a workload, job, or repository to highlight its known connections and open a detail panel. Nodes are keyboard-operable buttons.
- Search by name or platform/type. Matching items keep their related path context.
- Filter to a repository to inspect the workloads whose backup records reference it.
- Toggle **Attention** for reported failed/warning/disabled jobs, offline repositories, repositories at least 90% used, and workloads reporting zero restore points.
- The Operations overview retains Map and List and adds **Paths**, where each row shows a single backup's workload, job, and repository. Search also supports source IDs, backup names, and backup IDs. **Match type**, **No known connections**, and **Missing status / details** add investigation filters; connected items remain visible for context.
- Select **Focus these connections** to isolate the selected item's exact backup paths, then **Clear focus** to return to the filtered environment. Switching views retains filters and selection. Refresh retains filters for the same source.
- The detail panel preserves reported facts, backup names, connection navigation, and existing links. It adds source IDs, scoped path counts, repository investigation and restore-point links. The evidence table below the explorer retains backup IDs even when backup names are duplicated.
- Use zoom, fit-to-view, and the minimap, or switch to **List**. More than 250 matching items automatically use a list with 100 items per page; narrow filters to return to the map.
- Select **Refresh data** for a new snapshot. The footer shows its retrieval time; there is no automatic polling on this page.

## Meaning of the connections

The server reads paginated `/api/v1/backupObjects`, `/api/v1/backups`, `/api/v1/jobs/states`, and `/api/v1/backupInfrastructure/repositories/states`. It then requests `/api/v1/backups/{id}/objects` for backup membership, with at most four membership requests in flight.

Relationships are joined using API IDs, never names. Each backup retains its own workload, parent-job, and repository path. Selecting a repository therefore does not incorrectly include every workload that shares a job with one of its backups. All-zero job IDs are treated as absent; a confirmed workload-to-repository relationship can still be displayed without a job node.

The graph describes **existing backup records**, not the complete inventory of machines, configured job scope, or future data flows. Missing relationships and unavailable metadata are unknown. Restore-point counts do not establish freshness, RPO compliance, or recoverability. A repository's connected workload count is not a disaster-impact simulation; alternative copies may exist.

## Partial data and limits

- Core workload/backups failures produce an error state. Optional job/repository details or membership failures produce explicit partial-data notices; they never become fabricated healthy results.
- Responses are private and uncached. Destinations come from server-side source configuration; the topology route does not accept arbitrary destination URLs.
- The initial view reads at most 200 backups, with a 10,000-record limit per collection, a 100-page safeguard, and a 60-second request deadline. Reaching a collection limit produces a warning. Large environments may require future server-side scoping.
- No synthetic records or automatic demo fallback are included in the production page.

## Development and validation

```bash
npm install --legacy-peer-deps
npm run test:topology
npm run dev
```

The current repository dependency set requires legacy peer resolution for installation; this predates the topology feature. The new runtime packages are `@xyflow/react` and `elkjs`. The test suite uses the existing TypeScript compiler and Node's built-in test runner.

Tests cover exact repository membership, duplicate names, absent IDs/status, filtering, pagination and truncation, partial failures, malformed data, authentication failures, and request concurrency. The Operations revamp was also checked against the connected VBR source: 27 workload IDs, 21 jobs, 13 repositories, and 22 backups. Manual checks covered Map/List/Paths, exact repository scope, focus, keyboard selection, empty results, and 390px mobile layout. API membership gaps remain visible as coverage notices.

The Operations revamp adds regression coverage for exact edge highlighting through shared jobs, combined filters, backup searches, isolated items, metadata-only paths, nullable/sentinel repository capacity, and documented running/disabled job status. Unmeasured capacity no longer discards other repository states; it remains unknown. Positive restore-point counts still do not establish recovery readiness.

API references: [Backups](https://helpcenter.veeam.com/references/vbr/13/rest/1.3-rev1/tag/Backups/index.html), [Backup Objects](https://helpcenter.veeam.com/references/vbr/13/rest/1.3-rev1/tag/Backup-Objects/index.html).

## Dependency compatibility

The package override keeps D3 transition 3 with D3 zoom 3 used by React Flow. The existing geographic maps retain their D3 zoom 2 / transition 2 dependencies; sharing transition 2 with selection 3 breaks topology zoom controls.
