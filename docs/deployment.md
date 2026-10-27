# Deployment and data handling

Open Backup UI is a community application with platform-management actions and access to saved backup-system credentials. Review its access model and transport configuration before sharing an instance.

## Production build

```bash
npm ci --legacy-peer-deps
npm run build
npm start
```

The dependency lock currently requires legacy peer resolution. The build uses Next.js standalone output; [container instructions](../CONTAINER.md) describe the Docker image.

**Current TLS behavior:** `npm start` explicitly sets `NODE_TLS_REJECT_UNAUTHORIZED=0`, disabling certificate verification for outbound Node.js TLS requests. Setting that variable outside the script does not remove its override. Review the script and trust configuration before production use. The container starts `node server.js` directly, so it does not execute that script; some older platform adapters also have local-certificate handling that should be included in a deployment review.

Build-time fonts are downloaded through `next/font/google` and packaged with the application. Installation and a first build therefore need access to the package registry and font assets. The alarm geography also uses external geometry assets; account for these when planning offline use.

## Persistent storage and upgrades

Back up the runtime `data/` directory and the encryption key before replacing the application. Keep their permissions restricted to the runtime account.

| Storage | Contents |
| --- | --- |
| `data/sources.json` | Platform metadata and encrypted saved passwords |
| `data/settings.json` | AI configuration and encrypted provider key |
| `data/job-profiles.json` | Source-specific Policy Profiles and revisions |
| `data/capacity-history/` | Source-scoped repository observations |
| `data/capacity-collector/` | Collector status and scheduling/lease records |

These stores belong to the application instance, not individual users. Encryption at rest does not provide application authorization or tenant isolation.

The application uses `ENCRYPTION_KEY` when configured; otherwise it reads or creates `.open-backup-ui-key` in the runtime user's home directory. Preserve the same key when moving or recreating the instance. Passwords and AI keys use AES-256-CBC. The current implementation has a legacy default-key fallback if key creation fails; correct that failure before storing credentials.

Local `.env*` files, runtime data, and assistant attachments are excluded from Git and container build contexts. `.env.example` contains placeholders only. Do not include credentials or customer information in published screenshots or logs.

## Capacity collection

The read-only collector starts with the Node server and attempts repository-capacity collection every 15 minutes for VBR sources with saved credentials, including a configured environment source. It does not require an open browser. Suspended/serverless processes cannot provide unattended collection.

- Use one persistent app instance with writable, persistent `data/` storage. The JSON/lease store is not a distributed scheduler.
- Set `CAPACITY_COLLECTOR_ENABLED=false` and restart to disable collection.
- Observations are bounded to 90 days and 20,000 readings per source. Tokens and passwords are not stored in capacity history.
- Physical forecasting needs three daily readings spanning at least 48 hours. Capacity resize, stale history, unsupported storage, and partial readings affect the available forecast.
- File/policy investigation remains on demand. Retained-file footprints, configured hold estimates, and stale/orphan candidates do not establish physical allocation, exact unlock times, or deletion eligibility.

See [Operations implementation notes](operations-revamp.md) for the model and its evidence limits.

## Remote access

The browser calls the application, and the application server calls the configured Veeam systems. A phone does not need direct access to those systems. Open `/connect` in a new browser to load the saved sources and select/connect them.

The application does not provide a separate, complete login and authorization boundary for a shared deployment. Place it behind an authenticated reverse proxy or private access layer covering the **entire hostname, including `/api/*`**. Protect that access before publishing a tunnel. For Cloudflare, use a named tunnel and a self-hosted Access application with explicit allowed identities; do not remove authentication to work around sign-in problems.

The proxy must preserve the original `Host` and set `X-Forwarded-Proto` to the client protocol. Open the public address over HTTPS so secure session cookies work. Internal application calls use loopback and `PORT` (default `3000`). Set server-only `INTERNAL_APP_URL` to a trusted internal origin for custom container routing; never use the public tunnel URL for internal calls.

## Configuration

UI-based source management is the primary setup path. The interface currently permits one configured source per platform type. Legacy environment configuration is also supported:

```env
VEEAM_API_URL=https://your-vbr-server:9419
VEEAM_USERNAME=your-username
VEEAM_PASSWORD=your-password

VBM_API_URL=https://your-vb365-server:4443
VBM_USERNAME=your-username
VBM_PASSWORD=your-password

VEEAM_ONE_API_URL=https://your-veeam-one-server:1239
VEEAM_ONE_USERNAME=your-username
VEEAM_ONE_PASSWORD=your-password

VRO_API_URL=https://your-vro-server:9898
VRO_USERNAME=your-username
VRO_PASSWORD=your-password

CAPACITY_COLLECTOR_ENABLED=true
# INTERNAL_APP_URL=http://127.0.0.1:3000
```

Use an uncommitted `.env.local` for development. Source selection differs in older routes; avoid competing UI and environment sources for the same platform. `OPENAI_API_KEY` remains a fallback for the summary route; use **Administration → AI Integrations** for provider/model configuration.

## AI and telemetry

Generating an AI summary sends selected environment context, including names and event details, to the configured OpenAI, Google, or Anthropic provider. It is optional and user-triggered. Check its output against the source records.

PostHog initializes by default unless disabled in that browser. Automatic page views and session recording are disabled; configured interaction/error collection and browser-local sharing preferences are described in **Administration → Telemetry**. Preferences synchronize across tabs. Local diagnostics do not send test events or verify delivery. Next.js build telemetry is separate and can be disabled with `NEXT_TELEMETRY_DISABLED=1` during build.

## Release validation

```bash
npm ci --legacy-peer-deps
npm test
npm run typecheck
npm run build
```

Validate in a separate checkout or directory when a development server is running; development and production builds share `.next/`. A successful build and automated suite do not certify every API action against every supported platform version.
