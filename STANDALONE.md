# Run the standalone release

The `open-backup-ui-v1.2.0-standalone.zip` artifact contains the production build, its runtime dependencies, public images, and documentation. GitHub Actions builds it on **Ubuntu Linux x64 with Node.js 20**. Its bundled native dependencies make it a Linux release; for Windows, macOS, or another architecture, use the source ZIP and install/build on that platform.

Extract the entire archive and open a terminal inside the extracted application directory. Keep `server.js`, `node_modules`, `.next`, `public`, `scripts`, and `lib` together. The standalone archive is already built; it does not require `npm ci` or `npm run build`.

## Start over HTTP

With a compatible Node.js runtime installed:

```bash
node server.js
```

Open `http://localhost:3000/connect`. To change the listening address or port on Linux:

```bash
HOSTNAME=127.0.0.1 PORT=3000 node server.js
```

Configure connections from the application. See [deployment and access requirements](docs/deployment.md) before making the instance available to other people.

## Optional managed HTTPS

Install OpenSSL and make its executable available on `PATH` before the first start. From the same application directory:

```bash
node scripts/https-server.cjs
```

Open `https://localhost:3443/connect`. The first run creates an installation-specific self-signed certificate. `HTTPS_PORT` and `HTTPS_BIND` configure the listener; `OPENSSL_BIN` can point to another OpenSSL executable. Set a server-side `HTTPS_ADMIN_TOKEN` to enable certificate replacement through **Administration → Settings → HTTPS & certificates**. See the [HTTPS guide](docs/https.md) for token requirements, trusted certificates, and persistence.

Run either the HTTP server or the HTTPS launcher for an instance. The HTTPS launcher starts and manages its own internal HTTP server.

## Optional read-only kiosk listener

The archive includes the separate kiosk gateway. Configure `KIOSK_PUBLIC_ORIGIN`, `KIOSK_APP_URL`, and the listener address as described in the [Kiosk Builder sharing guide](docs/labs.md#sharing-with-other-machines-on-your-lan), then run `node scripts/kiosk-server.cjs` in a second process. This listener serves shared views; the main application must also be running.

## Upgrades and source files

Keep runtime `data/` and the instance's encryption key when upgrading. Neither archive includes an existing installation's credentials or runtime state. Follow the [persistence and upgrade guide](docs/deployment.md#persistent-storage-and-upgrades).

To develop, rebuild, or run on another platform, use `open-backup-ui-v1.2.0.zip`, the source archive, and follow [README](README.md). Both archives include the [v1.2.0 release notes](docs/releases/v1.2.0.md), deployment guides, and the existing [Operations screenshot gallery](docs/releases/v1.0.0-gallery.md).
