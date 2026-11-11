# Changelog

## 1.2.0 (in development)

- Start a VM restore from the selected calendar or table entry. Set the recovered VM name and destination together and review the settings before submission.
- Start recoveries by goal in Recovery Center, then follow their progress in the recovery session. Sessions also lists mounted recoveries and their logs, including actions to migrate a recovered VM or stop publishing.
- Browse guest files, Active Directory objects, and SQL databases inside the recovery session. The Active Directory toolbar groups Restore, Export and the recovery cart above the object grid.
- Search and filter fields use the selected Glass theme's surface and foreground colors.

See the [VM restore API map](docs/vm-restore-api.md) for the launch payloads and recovery lifecycle endpoints.

## 1.0.1

- **AI summary PDF export:** download the completed analysis as an A4 or US Letter report with an editorial cover, linked contents, numbered sections, confidence labels, highlighted recommendations, repeating table headers and page numbers. Optional analysis notes, localized labels and embedded Noto fonts preserve all summary tabs and multilingual resource names. Export runs locally in the browser without another provider request; incomplete or failed analyses cannot be exported.
- **AI provider errors:** health summaries preserve provider failures before and during streaming, including Gemini HTTP 402 credit errors. The panel shows the provider, status and sanitized diagnostic with relevant settings/billing links; incomplete and empty responses no longer appear to be successful analyses.
- **AI configuration saves:** same-origin validation uses the requested application host, so local IPs, LAN URLs and HTTPS proxy URLs work when the server listens on all interfaces. Save/check feedback appears beside its action, and stalled requests time out without discarding the draft.
- **AI health summary:** a compact panel follows Branding typography, colours, Glass surfaces and density. Explicit generation and refresh controls, accessible section tabs, collapsible results, and concise loading, empty and error states replace the fixed-height empty sidebar layout.
- **Kiosk Builder (Labs):** an opt-in canvas under Settings, with top-level navigation, draw-to-create widgets, magnetic alignment, cascading widget repulsion, enforced spacing, tidy/lock controls, zoom/pan, and keyboard-accessible layout controls. Growing or moving a widget pushes its neighbours aside and below at the canvas edge, with one-step undo.
- **Live evidence:** sixteen VBR data sources reuse the current APIs and forecast cache. Missing readings, partial collections, running retries, and backup-copy identity retain their existing semantics.
- **Personal exploration:** ten views with live previews, field search, compound filters, columns, measures, aggregation, category visibility, UTC time buckets, palettes, and density controls.
- **Names and series:** explicit categories, values, per-measure calculations, named KPI cards, job-based time series, editable series names/visibility, and full names with values in legends. Repository and history presets provide useful starting points; job names resolve by ID.
- **Reusable compositions:** browser-local, source-scoped layouts, undo/redo, duplication, validated JSON import/export, and configurable auto refresh from 30 seconds to 10 minutes. Exported files contain configuration rather than fetched backup records.
- **Readable object grids:** stable card heights, names, status, measures, latest timestamps, grouped objects or individual records, and identity-aware event counts.
- **Branding throughout:** Kiosk Builder follows the console’s typography, colours, density, corners and Glass transparency; legacy default palettes migrate automatically.
- **Read-only sharing:** publish a live kiosk with an unguessable link, optional password, viewer refresh controls, explicit updates and revocation. Public responses contain only projected display data. The standalone kiosk listener (`npm run start:kiosk`) exposes shared views on a separate port or hostname, blocks private routes and strips console credentials. The editor stays on its trusted interface; no console login is added.

- **Forecast Lens preview:** a compact repository chart reads only the selected source's existing forecast cache, with the repository name, collection time, current size and a supported 30-day projection. The sample remains stable within each cached snapshot, marks stale/partial evidence, and opens the same repository and forecast basis.
- **Kiosk monitoring catalog:** Capacity Forecast with repository, basis and 30/60/90-day selection; cached repository runway, backup footprint, retention and hygiene; live operations summary, proxies, managed servers and license health. Sixteen sources have configurable views and presets, including read-only sharing. Refresh retains dated readings while loading; cached sources show original collection time and stale status without triggering collections.
- **Shared kiosk TV mode:** full-screen presentation automatically tiles widgets to fill landscape, portrait and 4K screens with consistent padding; an optional saved-arrangement mode preserves the composition. Controls hide when idle, Escape exits, auto refresh starts at the viewer’s chosen interval, and embedded browsers retain a viewport-fitted fallback when native fullscreen is unavailable.
- **Consistent kiosk icons:** all sixteen data sources and ten view types use relevant Lucide icons with shared sizing and stroke weights. Source identities carry through the chooser, inspector, widget headers, object cards and shared TV views, using Branding colours.

[Full release notes](docs/releases/v1.0.1.md) · [Visual guide](docs/releases/v1.0.1-gallery.md) · [Kiosk Builder guide](docs/labs.md) · [AI PDF export](docs/ai-summary-pdf.md)

## 1.0.0 — release candidate

- **Clean installation:** normal `npm install` and `npm ci` work without peer-dependency bypasses. Unused React 18-only packages are removed, React/Next.js and compatible dependencies are updated, and CI checks the dependency tree.
- **Protection Lens:** Overview, Job Operations, Capacity Watch, and Capacity Forecast with a selectable default view.
- **Storage planning:** retention-aware file projections, collected capacity history, immutability investigation, and backup hygiene.
- **Planning cache:** source-scoped server-memory snapshots refresh every 30 minutes in the background for saved VBR connections. Manual Refresh bypasses the interval; transient failures keep the previous snapshot and its collection time visible.
- **Job creation:** a guided VMware/Hyper-V builder with native payload review and reusable Policy Profiles.
- **Investigation:** workload errors, session/task logs, supported retry chains, restore-point evidence, topology, and workload resilience.
- **Operations throughout:** refreshed VBR, Microsoft 365, Veeam ONE reports/alarms, and administration views.
- **Navigation and appearance:** search previews, expandable filter rails, sortable dates, compact controls, phone navigation, and three Glass themes.
- **Interface languages:** eleven bundled locales with browser detection, a saved preference, and localized date/number formatting in migrated views. VBR widgets, Policy Profile editors, creation flows, job/session investigations, repository and restore-point details, and Microsoft 365 investigations include their labels, counts, statuses, descriptions, and known application diagnostics.
- **Localized AI summaries:** health-summary requests use the selected interface language while keeping quoted provider and source diagnostics intact.
- **Connection showcase:** feature screenshots on `/connect` with localized captions, manual navigation, pause/play controls, and reduced-motion support.
- **Application settings:** a language/region panel and optional managed HTTPS with certificate inspection, validated PEM replacement, and live certificate reload. Existing reverse-proxy deployments remain supported.
- **Release documentation:** updated setup, localization coverage, HTTPS deployment guidance, PR copy, illustrated release notes, and a screenshot gallery with capture provenance.

[Full release notes](docs/releases/v1.0.0.md) · [Screenshot checklist](docs/releases/v1.0.0-screenshots.md)

Earlier releases are available in the [GitHub release history](https://github.com/jorgedlcruz/open-backup-ui/releases).
