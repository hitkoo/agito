export type DockSplitDirection = 'horizontal' | 'vertical'

export interface DockSurface {
  id: string
  characterId: string
}

export interface DockPaneNode {
  type: 'pane'
  id: string
  surfaces: DockSurface[]
  activeSurfaceId: string | null
}

export interface DockSplitNode {
  type: 'split'
  id: string
  direction: DockSplitDirection
  children: [DockLayoutNode, DockLayoutNode]
  sizes: [number, number]
}

export type DockLayoutNode = DockPaneNode | DockSplitNode

export interface DockLayout {
  root: DockLayoutNode
  focusedPaneId: string
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function createPane(): DockPaneNode {
  return {
    type: 'pane',
    id: createId('pane'),
    surfaces: [],
    activeSurfaceId: null,
  }
}

function createSurface(characterId: string): DockSurface {
  return {
    id: createId('surface'),
    characterId,
  }
}

function cloneLayout(layout: DockLayout): DockLayout {
  return structuredClone(layout)
}

function findPaneInNode(node: DockLayoutNode, paneId: string): DockPaneNode | null {
  if (node.type === 'pane') {
    return node.id === paneId ? node : null
  }

  for (const child of node.children) {
    const found = findPaneInNode(child, paneId)
    if (found) return found
  }

  return null
}

function replacePaneInNode(node: DockLayoutNode, paneId: string, replacement: DockLayoutNode): DockLayoutNode {
  if (node.type === 'pane') {
    return node.id === paneId ? replacement : node
  }

  return {
    ...node,
    children: node.children.map((child) => replacePaneInNode(child, paneId, replacement)) as [
      DockLayoutNode,
      DockLayoutNode,
    ],
  }
}

function findSurfaceInPane(
  pane: DockPaneNode,
  surfaceOrCharacterId: string
): { surface: DockSurface; index: number } | null {
  const index = pane.surfaces.findIndex(
    (surface) => surface.id === surfaceOrCharacterId || surface.characterId === surfaceOrCharacterId
  )
  if (index < 0) return null

  return {
    surface: pane.surfaces[index]!,
    index,
  }
}

function findSurfaceInNode(
  node: DockLayoutNode,
  surfaceOrCharacterId: string
): { paneId: string; surface: DockSurface; index: number } | null {
  if (node.type === 'pane') {
    const found = findSurfaceInPane(node, surfaceOrCharacterId)
    if (!found) return null
    return {
      paneId: node.id,
      surface: found.surface,
      index: found.index,
    }
  }

  for (const child of node.children) {
    const found = findSurfaceInNode(child, surfaceOrCharacterId)
    if (found) return found
  }

  return null
}

function setActiveSurfaceAfterRemoval(pane: DockPaneNode, removedIndex: number): void {
  if (pane.surfaces.length === 0) {
    pane.activeSurfaceId = null
    return
  }

  const nextIndex = Math.min(removedIndex, pane.surfaces.length - 1)
  pane.activeSurfaceId = pane.surfaces[nextIndex]?.id ?? null
}

function findPaneIdsInOrder(node: DockLayoutNode, acc: string[][]): void {
  if (node.type === 'pane') {
    acc.push(node.surfaces.map((surface) => surface.characterId))
    return
  }

  for (const child of node.children) {
    findPaneIdsInOrder(child, acc)
  }
}

function findFirstPaneId(node: DockLayoutNode): string {
  if (node.type === 'pane') return node.id
  return findFirstPaneId(node.children[0])
}

function removePaneFromNode(node: DockLayoutNode, paneId: string): DockLayoutNode | null {
  if (node.type === 'pane') {
    return node.id === paneId ? null : node
  }

  const left = removePaneFromNode(node.children[0], paneId)
  const right = removePaneFromNode(node.children[1], paneId)

  if (!left && !right) return null
  if (!left) return right
  if (!right) return left

  return {
    ...node,
    children: [left, right],
  }
}

function updateSplitSizesInNode(
  node: DockLayoutNode,
  splitId: string,
  sizes: [number, number]
): DockLayoutNode {
  if (node.type === 'pane') return node
  if (node.id === splitId) {
    return {
      ...node,
      sizes,
    }
  }

  return {
    ...node,
    children: node.children.map((child) => updateSplitSizesInNode(child, splitId, sizes)) as [
      DockLayoutNode,
      DockLayoutNode,
    ],
  }
}

export function createEmptyDockLayout(): DockLayout {
  const pane = createPane()
  return {
    root: pane,
    focusedPaneId: pane.id,
  }
}

export function getPaneById(layout: DockLayout, paneId: string): DockPaneNode | null {
  return findPaneInNode(layout.root, paneId)
}

export function listPaneCharacterIds(layout: DockLayout): string[][] {
  const panes: string[][] = []
  findPaneIdsInOrder(layout.root, panes)
  return panes
}

export function listOpenCharacterIds(layout: DockLayout): string[] {
  return listPaneCharacterIds(layout).flat()
}

export function findCharacterSurface(
  layout: DockLayout,
  characterId: string
): { paneId: string; surface: DockSurface; index: number } | null {
  return findSurfaceInNode(layout.root, characterId)
}

export function getActiveCharacterId(layout: DockLayout): string | null {
  const pane = getPaneById(layout, layout.focusedPaneId)
  if (!pane || !pane.activeSurfaceId) return null
  return pane.surfaces.find((surface) => surface.id === pane.activeSurfaceId)?.characterId ?? null
}

export function focusDockPane(layout: DockLayout, paneId: string): DockLayout {
  if (layout.focusedPaneId === paneId) return layout

  return {
    ...cloneLayout(layout),
    focusedPaneId: paneId,
  }
}

export function ensureCharacterSurface(layout: DockLayout, characterId: string): DockLayout {
  const next = cloneLayout(layout)
  const existing = findSurfaceInNode(next.root, characterId)

  if (existing) {
    const pane = getPaneById(next, existing.paneId)
    if (!pane) return next
    pane.activeSurfaceId = existing.surface.id
    next.focusedPaneId = pane.id
    return next
  }

  const pane = getPaneById(next, next.focusedPaneId)
  if (!pane) return next

  const surface = createSurface(characterId)
  pane.surfaces.push(surface)
  pane.activeSurfaceId = surface.id
  return next
}

export function splitDockPane(layout: DockLayout, paneId: string, direction: DockSplitDirection): DockLayout {
  const next = cloneLayout(layout)
  const pane = getPaneById(next, paneId)
  if (!pane) return next

  const newPane = createPane()
  const replacement: DockSplitNode = {
    type: 'split',
    id: createId('split'),
    direction,
    children: [pane, newPane],
    sizes: [50, 50],
  }

  next.root = replacePaneInNode(next.root, paneId, replacement)
  next.focusedPaneId = newPane.id
  return next
}

export function reorderPaneSurface(
  layout: DockLayout,
  paneId: string,
  surfaceOrCharacterId: string,
  targetIndex: number
): DockLayout {
  const next = cloneLayout(layout)
  const pane = getPaneById(next, paneId)
  if (!pane) return next

  const found = findSurfaceInPane(pane, surfaceOrCharacterId)
  if (!found) return next

  const [surface] = pane.surfaces.splice(found.index, 1)
  const boundedIndex = Math.max(0, Math.min(targetIndex, pane.surfaces.length))
  pane.surfaces.splice(boundedIndex, 0, surface)
  pane.activeSurfaceId = surface.id
  next.focusedPaneId = pane.id
  return next
}

export function activatePaneSurface(layout: DockLayout, paneId: string, surfaceOrCharacterId: string): DockLayout {
  const next = cloneLayout(layout)
  const pane = getPaneById(next, paneId)
  if (!pane) return next

  const found = findSurfaceInPane(pane, surfaceOrCharacterId)
  if (!found) return next

  pane.activeSurfaceId = found.surface.id
  next.focusedPaneId = pane.id
  return next
}

export function moveSurfaceToPane(
  layout: DockLayout,
  surfaceOrCharacterId: string,
  targetPaneId: string,
  targetIndex: number
): DockLayout {
  const next = cloneLayout(layout)
  const source = findSurfaceInNode(next.root, surfaceOrCharacterId)
  const targetPane = getPaneById(next, targetPaneId)
  if (!source || !targetPane) return next

  const sourcePane = getPaneById(next, source.paneId)
  if (!sourcePane) return next

  if (sourcePane.id === targetPane.id) {
    return reorderPaneSurface(next, targetPane.id, surfaceOrCharacterId, targetIndex)
  }

  sourcePane.surfaces.splice(source.index, 1)
  setActiveSurfaceAfterRemoval(sourcePane, source.index)

  const boundedIndex = Math.max(0, Math.min(targetIndex, targetPane.surfaces.length))
  targetPane.surfaces.splice(boundedIndex, 0, source.surface)
  targetPane.activeSurfaceId = source.surface.id
  next.focusedPaneId = targetPane.id
  return next
}

export function closeDockSurface(layout: DockLayout, paneId: string, surfaceOrCharacterId: string): DockLayout {
  const next = cloneLayout(layout)
  const pane = getPaneById(next, paneId)
  if (!pane) return next

  const found = findSurfaceInPane(pane, surfaceOrCharacterId)
  if (!found) return next

  pane.surfaces.splice(found.index, 1)
  setActiveSurfaceAfterRemoval(pane, found.index)
  return next
}

export function removeDockPane(layout: DockLayout, paneId: string): DockLayout {
  const next = cloneLayout(layout)
  const root = removePaneFromNode(next.root, paneId)

  if (!root) {
    return createEmptyDockLayout()
  }

  next.root = root
  next.focusedPaneId = getPaneById(next, layout.focusedPaneId)?.id ?? findFirstPaneId(root)
  return next
}

export function updateDockSplitSizes(
  layout: DockLayout,
  splitId: string,
  sizes: [number, number]
): DockLayout {
  return {
    ...cloneLayout(layout),
    root: updateSplitSizesInNode(layout.root, splitId, sizes),
  }
}
