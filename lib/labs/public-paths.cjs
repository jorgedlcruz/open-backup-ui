// Open Backup UI v1.2.0
/** Routes exposed by the standalone kiosk listener and by a public hostname. */
function publicPathAllowed(path, method) {
  if (method === 'GET' || method === 'HEAD') return /^\/share\/kiosk\/[A-Za-z0-9_-]{43}\/?$/.test(path)
    || /^\/api\/public\/kiosks\/[A-Za-z0-9_-]{43}\/?$/.test(path)
    || /^\/_next\/static\/[A-Za-z0-9_./%()-]+$/.test(path) && !/(?:%2e|%2f|%5c|\.\.)/i.test(path)
    || /^\/(favicon\.ico|icon-(192|512)\.png|apple-touch-icon\.png)$/.test(path)
  return method === 'POST' && /^\/api\/public\/kiosks\/[A-Za-z0-9_-]{43}\/unlock\/?$/.test(path)
}
module.exports = { publicPathAllowed }
