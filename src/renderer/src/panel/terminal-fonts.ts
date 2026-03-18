import { isBundledTerminalFontFamily } from '../../../shared/settings'

const pendingFontLoads = new Map<string, Promise<void>>()

function buildFontLoadDescriptor(family: string, size: number): string {
  return `400 ${Math.max(10, size)}px "${family}"`
}

export async function preloadTerminalFonts(
  families: string[],
  size: number
): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return

  const bundledFamilies = families.filter(isBundledTerminalFontFamily)
  if (bundledFamilies.length === 0) return

  await Promise.all(
    bundledFamilies.map(async (family) => {
      const descriptor = buildFontLoadDescriptor(family, size)
      const cached = pendingFontLoads.get(descriptor)
      if (cached) {
        await cached
        return
      }

      const loadPromise = document.fonts
        .load(descriptor, 'Ag')
        .then(() => undefined)
        .catch(() => undefined)

      pendingFontLoads.set(descriptor, loadPromise)
      await loadPromise
    })
  )
}
