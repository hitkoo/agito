import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IPCBridge } from '../shared/bridge'

const bridge: IPCBridge = {
  invoke: <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => {
    return ipcRenderer.invoke(channel, ...args) as Promise<T>
  },
  on: (channel: string, handler: (...args: unknown[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void =>
      handler(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  getPathForFile: (file: File): string => {
    return webUtils.getPathForFile(file)
  },
}

contextBridge.exposeInMainWorld('api', bridge)
