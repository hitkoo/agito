type FileLike = Partial<File> & {
  path?: string
}

interface DataTransferItemLike {
  kind?: string
  getAsFile?: () => FileLike | null
}

interface TerminalDropDataLike {
  types?: ArrayLike<string>
  items?: ArrayLike<DataTransferItemLike>
  files?: ArrayLike<FileLike>
}

type TerminalDropPathResolver = (file: FileLike) => string

export function isTerminalFileDrop(dataTransfer: TerminalDropDataLike | null | undefined): boolean {
  if (!dataTransfer) return false

  const types = Array.from(dataTransfer.types ?? [])
  if (types.includes('Files')) return true

  const items = Array.from(dataTransfer.items ?? [])
  if (items.some((item) => item.kind === 'file')) return true

  return Array.from(dataTransfer.files ?? []).length > 0
}

export function extractTerminalDropPaths(
  dataTransfer: TerminalDropDataLike | null | undefined,
  resolvePath: TerminalDropPathResolver = (file) => file.path ?? '',
): string[] {
  if (!dataTransfer) return []

  const itemPaths = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => {
      const file = item.getAsFile?.()
      return file ? resolvePath(file) : ''
    })
    .filter((path) => path.length > 0)

  if (itemPaths.length > 0) return itemPaths

  return Array.from(dataTransfer.files ?? [])
    .map((file) => resolvePath(file))
    .filter((path) => path.length > 0)
}

export function escapeTerminalDropPath(path: string): string {
  return path.replaceAll(' ', '\\ ')
}

export function buildTerminalDropInput(paths: string[]): string | null {
  const usablePaths = paths.map((path) => path.trim()).filter((path) => path.length > 0)
  if (usablePaths.length === 0) return null
  return `${usablePaths.map(escapeTerminalDropPath).join(' ')} `
}
