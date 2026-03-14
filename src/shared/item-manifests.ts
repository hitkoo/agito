import type { ItemManifest } from './types'

// Built-in items (always available)
const BUILTIN_MANIFESTS: ItemManifest[] = [
  { id: 'couch', name: 'Couch', category: 'furniture', footprint: { w: 2, h: 2 }, texture: 'sprites/sofa.png', anchor: { x: 0.5, y: 1.0 }, placementZone: 'floor', tags: ['seating'] },
  { id: 'plant-large', name: 'Large Plant', category: 'furniture', footprint: { w: 1, h: 1 }, texture: 'sprites/plants.webp', anchor: { x: 0.5, y: 1.0 }, placementZone: 'floor', tags: ['decor'] },
]

// Runtime list: built-in + custom (loaded from ~/.agito/custom-manifests.json)
export const ITEM_MANIFESTS: ItemManifest[] = [...BUILTIN_MANIFESTS]

export function getManifestById(id: string): ItemManifest | undefined {
  return ITEM_MANIFESTS.find((m) => m.id === id)
}

export function addManifest(manifest: ItemManifest): void {
  ITEM_MANIFESTS.push(manifest)
}

export function loadCustomManifests(manifests: ItemManifest[]): void {
  // Remove previously loaded custom manifests (keep built-ins)
  const builtinIds = new Set(BUILTIN_MANIFESTS.map((m) => m.id))
  const toRemove = ITEM_MANIFESTS.filter((m) => !builtinIds.has(m.id))
  for (const m of toRemove) {
    const idx = ITEM_MANIFESTS.indexOf(m)
    if (idx >= 0) ITEM_MANIFESTS.splice(idx, 1)
  }
  // Add custom manifests
  for (const m of manifests) {
    if (!builtinIds.has(m.id)) {
      ITEM_MANIFESTS.push(m)
    }
  }
}

export function getCustomManifests(): ItemManifest[] {
  const builtinIds = new Set(BUILTIN_MANIFESTS.map((m) => m.id))
  return ITEM_MANIFESTS.filter((m) => !builtinIds.has(m.id))
}
