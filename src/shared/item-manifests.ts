import type { ItemManifest } from './types'

// Built-in items — empty now; the asset folder IS the manifest
export const ITEM_MANIFESTS: ItemManifest[] = []

export function getManifestById(id: string): ItemManifest | undefined {
  return ITEM_MANIFESTS.find((m) => m.id === id)
}
