declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, channel: WebSocket)
    scaleViewport: boolean
    disconnect(): void
    focus(): void
    sendCtrlAltDel(): void
  }
}
