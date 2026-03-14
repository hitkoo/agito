import type { IPCBridge } from '../shared/bridge'

declare global {
  interface Window {
    api: IPCBridge
  }
}
