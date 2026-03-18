/**
 * IPCBridge — abstract interface for IPC communication.
 *
 * Electron implementation: ipcRenderer.invoke / ipcRenderer.on
 * Future Tauri implementation: tauri.invoke / tauri.event.listen
 *
 * Renderer code only imports this interface, never Electron APIs directly.
 */
export interface IPCBridge {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>
  on(channel: string, handler: (...args: unknown[]) => void): () => void
  getPathForFile(file: File): string
}
