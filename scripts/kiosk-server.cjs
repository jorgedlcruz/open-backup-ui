// Open Backup UI v1.2.0
/* eslint-disable @typescript-eslint/no-require-imports */
const { loadEnvConfig } = require('@next/env')
const { createKioskServer } = require('./lib/kiosk-gateway.cjs')
loadEnvConfig(process.cwd())
const port = Number(process.env.KIOSK_PORT || 3102), host = process.env.KIOSK_HOST || '127.0.0.1'
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('KIOSK_PORT must be a valid port.')
if (!process.env.KIOSK_PUBLIC_ORIGIN) throw new Error('Set KIOSK_PUBLIC_ORIGIN to the kiosk URL in the app environment, then restart both listeners.')
const server = createKioskServer({
  appUrl: process.env.KIOSK_APP_URL || 'http://127.0.0.1:3101',
  publicOrigin: process.env.KIOSK_PUBLIC_ORIGIN,
  allowedSubnet: process.env.KIOSK_ALLOWED_SUBNET,
})
server.listen(port, host, () => console.log(`Read-only kiosk listening at ${host}:${port}; links use ${new URL(process.env.KIOSK_PUBLIC_ORIGIN).origin}/share/kiosk/<id>`))
server.on('error', error => { console.error(`Kiosk listener failed: ${error.message}`); process.exitCode = 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))
