import { Texture } from 'pixi.js'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'

const textureCache = new Map<string, Texture>()

export async function loadTexture(path: string): Promise<Texture | null> {
  if (!path) return null

  if (textureCache.has(path)) return textureCache.get(path)!

  try {
    // Strip "sprites/" prefix if present, keep subdirectory structure (e.g. "office/file.png")
    const relPath = path.startsWith('sprites/') ? path.slice(8) : path
    if (!relPath) return null

    // Load as base64 data URL via IPC (bypasses file:// security restriction)
    const dataUrl = await window.api.invoke<string | null>(
      IPC_COMMANDS.SPRITE_READ_BASE64,
      relPath
    )
    if (!dataUrl) return null

    const texture = Texture.from(dataUrl)
    textureCache.set(path, texture)
    return texture
  } catch {
    return null
  }
}

export function getCachedTexture(path: string): Texture | null {
  return textureCache.get(path) ?? null
}

export function clearTextureCache(): void {
  for (const [, tex] of textureCache) tex.destroy()
  textureCache.clear()
}
