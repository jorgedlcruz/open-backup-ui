// Open Backup UI v1.3.0
const channelName = 'open-backup-ui-vbr-selection'

export function notifyJobSourceChanged() {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(channelName)
  try {
    channel.postMessage('changed')
  } finally {
    channel.close()
  }
}

export function observeJobSourceChanges(reset: () => void) {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(channelName)
  channel.onmessage = event => { if (event.data === 'changed') reset() }
  return () => channel.close()
}
