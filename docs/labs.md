# Kiosk Builder (Labs)

Kiosk Builder is an experimental personal workspace introduced in v1.0.1. Enable it in **Administration → Settings → Labs**. The **Kiosk Builder** entry then appears in the top bar and main menu, at the existing `/labs` route. The preference belongs to this browser and is disabled by default. Turning it off hides the entry and canvas; it retains saved compositions.

## Create and shape a view

Drag across the dotted canvas to select a rectangle, or use **New widget** with a keyboard or touch device. Choose a data source, then a visual form. The inspector opens with a live preview and **Mapping & series** controls. **Data & filters** controls search, history window, and up to twelve AND filter rules. **Style & layout** controls colors, names/values on labels, legend values, density, curves, stacking, position, and dimensions.

Move widgets by their headings and resize from their lower-right corner. Layout fields provide equivalent keyboard controls. Geometry snaps to a 20-pixel grid, with magnetic edge alignment and visible guides. **Spacing** enforces 20, 40, 60, or 80 pixels between widgets and at canvas edges. Moving, resizing, or drawing a new widget repels neighbouring widgets in sequence while preserving the selected size and anchor. Neighbours move in their original direction from the edited widget; when they reach a canvas edge, they move below. Unaffected widgets stay in place. The live preview is calculated from the original gesture, so shrinking back does not leave gaps or accumulated drift. The entire cascade is one undo/redo action; Escape cancels a drag. **Tidy layout** arranges rows; **Lock layout** prevents movement, resizing, additions and deletions while leaving data configuration available. Each layout action can be undone.

The canvas is 1440 pixels wide and grows down from 2400 pixels as needed, up to 100,000 pixels. Pan, zoom and fit controls help navigate it. Up to forty widgets can share a canvas; each shows up to five hundred records or groups. Chart limits apply after grouping and category visibility. Split charts show up to 24 series groups (12 by default), after series visibility. Footers report visible groups and series. Total KPIs use all filtered rows; named KPIs use each visible group's rows.

## Map names to values

**Category labels** (or **X axis**) names the groups. **Values** selects numeric fields or record count, each with its own display name and sum/average/min/max calculation. Percentages default to average. **Split into series** creates independent series for each selected job, state, or other text field. **Series names & visibility** lets you search, rename and hide those series; aliases never change source identity or the calculation.

- Repository capacity: use **Space by repository** for repository names alongside used space, **Used and free** for a stacked comparison, or **Capacity cards** for named KPIs.
- Job history: use **Sessions by job**, **Job trends** (time on X, one line per job), or **Outcomes by job** (jobs split by result/state).
- Object grids have separate **Node name**, **Node detail**, colour grouping and value controls. Tables let you choose columns; job history includes the job name by default.

Legends wrap full names and show formatted values. Truncated chart axes retain full names in tooltips and legends. Named groups use source IDs where available, keeping different objects with identical names separate. Job history resolves job names by job ID (case-insensitive); unmatched sessions retain the reported session name. The **Job name evidence** field identifies the fallback. No name-based join is guessed.

Split-series legend totals use the displayed categories, with averages calculated over their original rows. Missing samples remain gaps. Charts with incompatible units explain the mismatch; choose compatible measures or use named KPI cards/a table instead.

Grid nodes open a record inspector. Table headings sort the visible records. Chart legends and tooltips identify measures and categories. The canvas can render grids, tables, donuts, pies, bars, lines, time series, KPIs, mosaics, and radars.

## Evidence and scope

The initial source catalog is VBR. Sources use the selected VBR connection and its existing read APIs, credentials, pagination limits, caches, and permissions. Labs does not introduce a new backend connection or write to backup systems. Microsoft 365 and Veeam ONE sources are not part of this first catalog.

| Source | Meaning |
| --- | --- |
| Protected Data | One row per backup-object copy, using the existing protected-data model. |
| Protected Objects | One row per workload ID; largest reported copy size; summed recovery counts only when every copy reports a count. A workload has recovery coverage if any copy has restore points. |
| Job History | Protection sessions within 24 hours, 7 days, or 30 days. Restore and maintenance sessions are excluded. Active sessions retain their current state, not their previous result. |
| Current Job State | Current job status, previous result, object count, progress and schedule. |
| Malware Events | Reported events, including resolved events. Use resolution-state filters for active detections. Data-reduction heuristics are not represented as confirmed malware. |
| Repository Capacity | Extents and standalone repositories; known aggregate parents are excluded. Shared backing volumes may overlap. |
| Security Posture | Reported security best-practice results. |
| Capacity Forecast | Select a repository, recorded volume usage or a backup-file retention scenario, and a 30/60/90-day horizon. Uses the existing scoped forecast cache. |
| Repository Runway | Cached physical usage, growth in GB/day, days to 80%, and 30/60/90-day projected usage. Aggregate parents excluded. |
| Backup Footprint | File bytes and policy projections by backup, with job/repository names and modeled coverage. |
| Retention Evidence | File categories, chain dependencies and configured hold windows; these are not reclaimable disk bytes. |
| Backup Hygiene | Verified restore-point age, missing job references and review findings. File creation dates do not substitute for restore-point age. |
| Operations Summary | Active jobs, attention, completed-session outcomes and success rate, repository risk and security counts. History window selectable. |
| Backup Proxies | Readiness, reported online/disabled/outdated state, transport, host and configured task limits. Task limits are not active task counts. |
| Managed Servers | Reported status, update state, infrastructure role assignments and update deadlines. |
| License Health | Entitlement usage, units, expiry and support days. Filter by unit before combining license quantities. |

Unavailable sources show an explicit error. Partial evidence stays marked. Unknown numeric values remain missing, not zero. Numeric aggregates use reported values. Count measures count matching records; they do not imply unique workloads unless using Protected Objects. Time buckets use UTC and include only observed buckets, without inventing zero readings in missing periods. Date predicates accept ISO timestamps. Imported layout values are untrusted and validated before replacing the current composition.

Requests with the same endpoint and selection are shared within a refresh. Each source appears as soon as its request completes; slow sources do not hold up other widgets. The canvas only requests sources used by its widgets. Refresh is manual unless the user enables auto refresh; automatic refresh pauses in hidden tabs. Previous readings remain visible during refresh with their collection timestamp and a refreshing indicator; changing the selected server clears them. An error can be retried with Refresh.

The five cached planning sources (forecast, runway, footprint, retention and hygiene) never start a new collection when a screen refreshes. They read the same authenticated cache used by Capacity Forecast. The background collector normally updates it every 30 minutes. Cold caches, unavailable repositories, insufficient trend history, partial evidence and stale cache are explicit. The timestamp is the original collection time, not the time the kiosk polled. A restart clears this in-memory cache until the collector warms it again. Select **Repository** in the inspector; all repositories are available for inventory sources, while a forecast charts one selected repository. Recorded volume trends require sufficient history. File scenarios use the existing retention model and distinguish modeled files from total volume utilization.

Every new source has suggested views under **Mapping & series**, while the existing column, measure, calculation, search, filter, alias and visibility controls remain available. Forecast lines distinguish recorded evidence from dashed future scenarios. Public widgets use the published selection and only expose the rendered fields, repository name and series; repository option lists and raw cached snapshots stay private.

## Saving and portability

Layouts save automatically in browser storage, separately for each selected VBR source. They are personal to this browser and origin, not shared across users or devices. Export a JSON canvas for portability. It contains widget configuration, names, aliases, and filter text, but no fetched records or credentials. Import validates version, geometry, widget count and IDs. Version 1 and 2 layouts upgrade to version 3, preserving IDs and query configuration while resolving overlaps and outer padding. The original browser storage key remains supported. Import replaces the current composition and can be undone. A corrupt stored canvas is not silently overwritten. Browser storage failures are visible; export remains available.

Undo/redo retains fifty changes during the current visit. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z work outside text inputs. Reloading preserves the canvas but clears undo history. The feature uses existing Recharts and CSS/SVG, with reduced-motion support and light/dark styling.

Labs uses the existing translation provider; new experimental copy initially falls back to English while existing translated labels and number/date formatting follow the selected locale.

## Validation

`npm run test:labs` checks aggregation and unknown values, compound predicates, UTC grouping, sorting, import limits, every source/view default, protection-session filtering, running retries, capacity deduplication, workload identity, evidence availability, and the browser preference endpoint. Run `npm run typecheck`, `npm test`, and `npm run build` for repository integration validation.

## Branding and object cards

The builder inherits Branding’s font, preset, accent, chart palette, density, radii, panel surfaces and Glass transparency. Existing Atelier defaults migrate to **Branding**; explicitly selected Ocean/Ember chart palettes remain custom choices. Change **Chart palette → Branding** to follow the console palette.

Source and visualization icons use the same Lucide family as the rest of the console. Each source keeps its icon in the chooser, inspector, widget heading, object cards and shared viewer: for example, Malware Events uses an alert shield, Security Posture a checked shield, Job History a history clock, and Repository Capacity a drive. Source icons identify the data type, not a healthy or unhealthy result; their colours follow Branding.

Object grids have readable, scrollable cards with names, status, record count, measures and the latest reported timestamp. **Cards represent** switches between grouped objects and individual records. Groups use the name field’s source identity where available; different identities with the same name remain separate and get short ID suffixes. Mixed states are shown as Mixed. Open a card to inspect up to 20 underlying records, or use a table for more.

## Read-only sharing

Choose **Full screen** in a shared kiosk for TV mode. **Fit to TV** automatically arranges widgets into a grid suited to the screen’s width and height, keeping their visual reading order and the published padding between tiles and around the screen. The last row shares any leftover width, and large displays enlarge widget typography. It refits after a resize or orientation change. **Screen layout → Saved arrangement** instead preserves the composition’s original positions and proportions, centered and uniformly scaled to fit; its inner gaps scale with the composition and its outer margin stays in screen pixels. Neither mode changes the published layout. Dense boards can still have small text, and tables or object collections retain their internal scrolling; use focused widgets for a TV.

Entering full screen turns on auto refresh at the selected interval. Move the pointer, touch the screen or press a key to reveal the refresh and exit controls; they fade when idle. **Escape** or **Exit full screen** returns to the regular viewer. Read-only access, passwords and revocation still apply. If the browser or embedded viewer refuses native fullscreen, TV mode still fits within the browser window. Exiting does not change the published layout or refresh defaults.

Choose **Share** in the builder, select **Anyone with the link** or **Password protected**, configure refresh, then **Publish read-only link**. A published view captures the current layout, queries, visibility and branding. Its values come from the saved VBR connection. Editing your personal canvas does not change an existing shared view until you choose it in the dialog and select **Update shared view**. Passwords must have 10–128 characters; leave the password empty when updating to retain it. Changing a password invalidates existing viewer sessions. **Revoke link** stops subsequent reads. Data already viewed or downloaded cannot be recalled.

Viewers have no configuration, import, edit, deletion, connection or drill-through controls. Tables, grids and charts receive only the projected display data. Hidden columns, hidden series values, query/filter text, grouping IDs, raw records behind aggregates, source diagnostics and credentials are not included. Names and IDs explicitly displayed in selected columns or disambiguation labels remain visible. The data is not anonymized: review your widget names, visible fields, filters and chart labels before publishing. All public data reads use GET against the saved source; viewer cookies and query parameters cannot select another connection, data range or query.

Auto refresh is optional, with intervals of **30 seconds, 1, 2, 5 or 10 minutes**. Builder preferences are saved with the canvas and become the published defaults. Each viewer can override refresh locally. Hidden tabs pause automatic polling; requests do not overlap. Public reads are coalesced and cached for 30 seconds after completion, so a manual refresh within that window can return the same reading. Errors retain previous readings with an explicit notice; denied or revoked links clear them on the next request. A disconnected or reconfigured source fails closed.

Links and password hashes persist under `data/kiosk-shares/`. Persist that directory with the application’s data volume. Passwords use salted scrypt hashes; unlock cookies are HttpOnly, SameSite=Strict, Secure on HTTPS, and expire after eight hours. Password attempts are limited to ten per five-minute window per link. Links are unguessable random tokens and must be treated as access credentials. Public viewer pages disable telemetry and indexing, send no-referrer headers, and are not frameable. Layouts are stored server-side; fetched source records are cached only in memory.

An HttpOnly ownership cookie allows the creating browser to list, update and revoke its links, scoped to the selected source. Keep that cookie; clearing it loses in-app ownership management. Operators can revoke a lost link by deleting its matching `<link-id>.json` file from `data/kiosk-shares/`. Up to 50 links per browser/source and 200 per instance are supported. This feature does not add application-wide user authentication to the existing management console.

### A separate kiosk port on the same machine

The kiosk can have its own URL without another hostname or a new console login. Put these values in `.env.local` (or the launcher environment), then restart the app:

```dotenv
KIOSK_PUBLIC_ORIGIN=http://127.0.0.1:3102
KIOSK_APP_URL=http://127.0.0.1:3101
KIOSK_HOST=127.0.0.1
KIOSK_PORT=3102
```

Start the private app with `npm run start -- --hostname 127.0.0.1 --port 3101`, then start the viewer listener in a second process with `npm run start:kiosk`. Links created by **Share** now use `http://127.0.0.1:3102/share/kiosk/<id>`. The bare root URL intentionally returns 404: open a published link. Publishing requires `KIOSK_PUBLIC_ORIGIN`; it no longer falls back to the editor’s origin.

The listener allows only shared pages, their GET/HEAD data routes, password unlock POSTs, static assets and icons. Private pages, source APIs, configuration, sharing management, server actions and upgrades are blocked before reaching Next.js. Only the shared-view access cookie is forwarded; console cookies, Authorization and internal middleware headers are discarded. Upstream redirects must stay inside the allowed kiosk paths. The same route policy is also used by Next middleware as a second boundary.

Both listeners default to loopback. For access beyond a trusted LAN, expose only the kiosk listener through HTTPS. Set `KIOSK_PUBLIC_ORIGIN` to the externally reachable kiosk URL and preserve its Host header at the proxy; `KIOSK_APP_URL` remains the private internal destination. A different HTTPS port on the same hostname works. Keep the editor port bound to loopback or your trusted network. A different port is not a substitute for TLS or network isolation: cookies are shared across ports by browsers, which is why the gateway strips console credentials. No DNS, firewall, public tunnel, or external exposure is created automatically.

Run `node --test tests/kiosk-gateway.test.cjs` for live HTTP checks of route/method restrictions, header/cookie isolation, origin validation, request limits and redirect blocking.

### Sharing with other machines on your LAN

Use the server's LAN address for the public origin and kiosk listener. For example, if the server is `192.168.1.250` on `192.168.1.0/24`:

```dotenv
KIOSK_PUBLIC_ORIGIN=http://192.168.1.250:3102
KIOSK_HOST=192.168.1.250
KIOSK_PORT=3102
KIOSK_ALLOWED_SUBNET=192.168.1.0/24
KIOSK_APP_URL=http://127.0.0.1:3101
```

`KIOSK_ALLOWED_SUBNET` accepts one IPv4 or IPv6 CIDR. The gateway checks the connecting socket's IP address. Behind a reverse proxy, that address belongs to the proxy.

Keep starting the main app with `npm run start -- --hostname 127.0.0.1 --port 3101`. Restart both processes after changing these values. Only the kiosk binds to the LAN address; the editor and private APIs remain on loopback. Binding to the specific LAN IP also avoids listening on VPN and virtual adapter addresses. Reserve the server address in DHCP or use a static address so saved links remain valid.

On Windows, allow inbound TCP 3102 only for that local address and subnet. Run this in an elevated PowerShell, substituting your actual addresses:

```powershell
New-NetFirewallRule -Name 'OpenBackupUI-Kiosk-LAN-3102' `
  -DisplayName 'Open Backup UI - LAN kiosk (3102)' `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3102 `
  -LocalAddress 192.168.1.250 -RemoteAddress 192.168.1.0/24 -Profile Any
```

Do not open port 3101. In **Share**, select an existing shared view and copy its link again; both existing and new links are returned with the current public origin. The token, password and published configuration stay the same. Open the full `/share/kiosk/<id>` link from another LAN machine; `/` intentionally returns 404. Locally, `http://192.168.1.250:3101` should refuse connections, while `/labs` and private APIs on port 3102 return 404. A local request alone cannot verify another machine's firewall or network path, so also test the full link from a second machine.

Direct HTTP is for a trusted LAN and does not encrypt shared data or passwords. Use the HTTPS reverse proxy arrangement above when transport encryption is required. To remove the firewall exception, run `Remove-NetFirewallRule -Name 'OpenBackupUI-Kiosk-LAN-3102'` in an elevated PowerShell.

### Alternative: a dedicated public hostname

A loopback URL works only on the same computer. For remote sharing, provide a reachable HTTPS host. Keep the management console behind your existing trusted network or access gateway; **do not expose the full management application anonymously**.

Set `KIOSK_PUBLIC_ORIGIN=https://kiosk.example.com` and restart the app. Use a different hostname for administration. On the configured public Host, middleware permits only `/share/kiosk/<43-character-token>`, GET/HEAD `/api/public/kiosks/<token>`, POST `/api/public/kiosks/<token>/unlock`, Next static assets, and app icons. All management pages and APIs return 404 on that host. The reverse proxy must preserve Host, set X-Forwarded-Proto, and reject unrecognized hosts. Apply the same route allowlist at the internet-facing proxy; expose only the kiosk host publicly. Example Nginx routes inside the dedicated HTTPS server:

```nginx
server_name kiosk.example.com;
# Configure TLS certificates and standard proxy settings for your environment.
location ~ "^/share/kiosk/[A-Za-z0-9_-]{43}/?$" {
    proxy_pass http://127.0.0.1:3101;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location ~ "^/api/public/kiosks/[A-Za-z0-9_-]{43}(/unlock)?/?$" {
    proxy_pass http://127.0.0.1:3101;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location /_next/static/ {
    proxy_pass http://127.0.0.1:3101;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location ~ ^/(favicon\.ico|icon-(192|512)\.png|apple-touch-icon\.png)$ {
    proxy_pass http://127.0.0.1:3101;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location / { return 404; }
```

Use `node --test tests/kiosk-sharing.test.cjs` for projection, identity, password/ownership lifecycle, rate limiting, source binding, CSRF, request limits, revocation and public-host route checks.
