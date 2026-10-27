# Workload resilience explorer

Open a workload in Protection Topology and choose **Explore resilience**. The page at `/vbr/workloads/[id]` shows a repository timeline, selectable restore-point details and policy evidence. RPO choices of 4/12/24/48 hours are local exploratory settings, not saved backup policies. Sessions remain explicitly TBD.

## Evidence and scoring

Model v1 weights: freshness 25, two recent repository copies 20, deletion resistance 20, malware assessment 15, recovery verification 15, retention 5. Only established checks contribute confirmed points. The overall score remains Pending until all weighted evidence is known; unknown weights are never removed from the denominator. Coverage is the percentage of weights assessed, not collection completeness or recovery probability.

Freshness includes the exact RPO boundary. Copy count uses distinct nonzero repository IDs with recent points. Neither check establishes chain integrity, availability, failure-domain independence or a safe recovery candidate. A suspicious/infected returned point overrides the status. Clean is displayed as a reported label and never taken as proof of a recent scan. Malware scan provenance, point-level immutability, recovery verification and retention policy integration remain unknown. Data older than 15 minutes requires refresh; future timestamps are excluded from freshness and prevent negative conclusions based on completeness.

## Data contract and scope

The read-only workload API resolves the source server from configuration and shares authentication, cancellation, deadline and sanitized error handling with topology. It reads `/api/v1/backupObjects/{id}`, paginates `/api/v1/backupObjects/{id}/restorePoints`, and resolves destinations through `/api/v1/backups/{backupId}`. The dedicated reader does not use the older restore-point route that converts failures into empty results. Existing consumers of that older route are unchanged.

Limits: 2,000 restore points and 100 backup-detail lookups, with four concurrent destination requests. Truncation and partial enrichment are explicit. Required request failures and malformed records fail the assessment; optional destination failures leave mappings unresolved. Positive evidence can meet a check in a partial collection, but missing records cannot establish a gap.

Identity is the selected VBR backup-object ID within the active source. Same-named VMs are never merged. Cross-object workload reconciliation, infrastructure-versus-backup inventory coverage, independent-site verification, persisted protection policies, session parsing and fleet honeycomb views are future work. A score does not certify recoverability.

## Validation

Run `node --test tests/resilience.test.cjs tests/topology.test.cjs`. Tests cover RPO boundaries, stale copies, duplicate destinations, partial and stale evidence, security overrides, malformed/failed responses and bounded destination loading.

API reference: [VBR 13 / 1.3-rev1 Backup Objects](https://helpcenter.veeam.com/references/vbr/13/rest/1.3-rev1/tag/Backup-Objects/index.html).
