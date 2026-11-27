// Open Backup UI v1.3.0
export const browseProxyWaitMs = 30 * 60_000
export const proxyPollMs = 15_000

// Allow one final receipt read after the server's browse-start deadline.
export const browseReceiptWaitMs = browseProxyWaitMs + 30_000
