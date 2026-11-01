### Overview | Confidence: 96%
<thinking>
1. Compare the latest session results with the selected history window.
2. Correlate failed jobs with repository capacity and security checks.
</thinking>

The backup estate is protecting **124 workloads across three repositories**. Most scheduled jobs completed successfully, while two recurring failures and a capacity constraint need attention before the next backup window.

This is an illustrative report used to verify PDF layout, not a live assessment of an environment.

Recommendation: Review the affected workloads first, then address repository runway and the outstanding security checks. Use the linked sections in this report to follow the evidence.

### Operations Health | Confidence: 94%
<thinking>
1. Group repeated session failures by job identity.
2. Review available storage alongside recent backup growth.
</thinking>

#### Backup completion

The latest window contains **118 successful sessions**, four warnings and two failures. The warnings relate to transient network interruptions; the failures are concentrated in the file services workload.

- **File services / nightly:** the latest incremental run could not complete. Inspect the source share and available capacity before retrying.
- **Application services / hourly:** a retry completed successfully. Continue monitoring the next scheduled run.
- **Database protection:** all scheduled backups completed within the expected window.

| Repository | Used capacity | Free capacity | Forecast |
| --- | ---: | ---: | --- |
| London - primary | 82.4 TB | 17.6 TB | 23 days |
| Madrid - hardened | 41.8 TB | 58.2 TB | More than 90 days |
| Archive - object storage | 126.2 TB | Not reported | Not available |

Urgent: London - primary is approaching its capacity threshold. Review retention, growth and available expansion options before the next full backup.

Recommendation: Open the repository capacity forecast and verify its collection timestamp before making a storage change. Forecasts depend on the available history and the selected projection basis.

### Security Posture | Confidence: 92%

#### Configuration findings

Most checks passed. Three remaining findings require a configuration review:

1. Enable multifactor authentication for administrative access.
2. Verify that backup traffic encryption is enabled on the relevant network paths.
3. Confirm that immutable retention covers the required recovery window.

Recommendation: Prioritize administrative access controls and immutable backup coverage. Validate each setting against the environment's operational requirements.

For supporting guidance, see [the Veeam Help Center](https://helpcenter.veeam.com/).

### Audit Events | Confidence: 95%

Recent administrative activity includes a scheduled policy update and two rejected attempts to change retention. The rejected changes do not establish that backup data was modified.

| Time | Event | Result |
| --- | --- | --- |
| 08:15 | Scheduled policy refresh | Completed |
| 08:42 | Retention change request | Rejected |
| 09:03 | Repository rescan | Completed |

Recommendation: Review the originating account and change record for the rejected requests. Preserve the source audit records for follow-up.
