import {
  Fragment,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LoaderCircle,
  Minus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  SquareSplitHorizontal,
  SquareSplitVertical,
  X,
} from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useCharacterStore } from "../stores/character-store";
import { useUIStore } from "../stores/ui-store";
import { IPC_COMMANDS } from "../../../shared/ipc-channels";
import type {
  AssetListEntry,
  AgitoPersistentData,
  Character,
  ScannedSession,
} from "../../../shared/types";
import type { EngineType } from "../../../shared/types";
import {
  activatePaneSurface,
  closeDockSurface,
  ensureCharacterSurface,
  listOpenCharacterIds,
  moveSurfaceToPane,
  removeDockPane,
  reorderPaneSurface,
  splitDockPane,
  updateDockSplitSizes,
  type DockLayout,
  type DockLayoutNode,
  type DockPaneNode,
  type DockSurface,
} from "../../../shared/terminal-dock-layout";
import {
  getTerminalDockRenderMode,
  resolveSessionResumeEngine,
  shouldRenderAssignedTerminal,
} from "../../../shared/terminal-dock-state";
import { getCharacterMarkerStatus } from "../../../shared/character-runtime-state";
import { TerminalView } from "./TerminalView";
import {
  getOverlayScrollbarMetrics,
  getScrollLeftForThumbDrag,
} from "./terminal-dock-scroll";
import {
  getResizedTerminalDockBarHeight,
  getTerminalDockBarSideSlotWidth,
  resolveTerminalDockBarHeight,
  TERMINAL_DOCK_BAR_HEIGHT_STORAGE_KEY,
} from "../../../shared/terminal-dock-bar";
import {
  getCharacterStatusBadgeState,
  getCharacterDockPresence,
  getClosedCharacters,
  getMinimizedCharacters,
  getSurfaceDropInsertIndex,
  getSurfaceReorderIndexFromDropTarget,
  getLayoutForGlobalCharacterSessionAction,
  type GlobalCharacterSessionAction,
} from "./terminal-dock-ui";
import { buildSessionResumeInvokeArgs } from "../../../shared/session-resume";
import { toast } from "sonner";
import { useRuntimeStore } from "../stores/runtime-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Kbd } from "../components/ui/kbd";
import { cn } from "../lib/utils";

const ENGINE_DISPLAY: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

function CharacterStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}): ReactElement {
  const badgeState = getCharacterStatusBadgeState(status);

  if (badgeState.indicator === "spinner") {
    return (
      <LoaderCircle
        className={cn(
          "animate-spin [animation-duration:2s]",
          className,
        )}
        style={{ color: badgeState.color }}
      />
    );
  }

  return (
    <span className={cn("relative inline-flex shrink-0 align-middle", className)}>
      <span
        className={cn(
          "absolute inset-0 rounded-full border border-background",
          badgeState.pulse ? "animate-[status-pulse_1.5s_ease-out_infinite]" : "",
        )}
        style={{ backgroundColor: badgeState.color }}
      />
      {badgeState.ring ? (
        <span
          className={cn(
            "pointer-events-none absolute inset-0 rounded-full animate-[status-ring_1.5s_ease-out_infinite]",
          )}
          style={{ backgroundColor: badgeState.color }}
        />
      ) : null}
    </span>
  );
}

type SurfaceDragPayload = {
  sourcePaneId: string;
  surfaceId: string;
};

type SurfaceDropTarget = {
  paneId: string;
  index: number;
  mode: "insert" | "pane";
} | null;

function parseSurfaceDrag(event: React.DragEvent): SurfaceDragPayload | null {
  const raw = event.dataTransfer.getData("application/x-agito-surface");
  if (!raw) return null;

  try {
    return JSON.parse(raw) as SurfaceDragPayload;
  } catch {
    return null;
  }
}

function cloneLayoutWithFocusedPane(
  layout: DockLayout,
  paneId: string,
): DockLayout {
  return {
    ...structuredClone(layout),
    focusedPaneId: paneId,
  };
}

function OverlayScrollStrip({
  children,
  className,
  viewportClassName,
  noDrag = false,
}: {
  children: React.ReactNode;
  className?: string;
  viewportClassName?: string;
  noDrag?: boolean;
}): ReactElement {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragStartXRef = useRef(0);
  const dragStartScrollLeftRef = useRef(0);
  const [metrics, setMetrics] = useState(() => ({
    visible: false,
    thumbWidth: 0,
    thumbOffset: 0,
  }));
  const [thumbHovered, setThumbHovered] = useState(false);
  const [thumbDragging, setThumbDragging] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateMetrics = (): void => {
      setMetrics(
        getOverlayScrollbarMetrics({
          clientWidth: viewport.clientWidth,
          scrollWidth: viewport.scrollWidth,
          scrollLeft: viewport.scrollLeft,
        }),
      );
    };

    updateMetrics();

    viewport.addEventListener("scroll", updateMetrics, { passive: true });
    const resizeObserver = new ResizeObserver(updateMetrics);
    resizeObserver.observe(viewport);

    return () => {
      viewport.removeEventListener("scroll", updateMetrics);
      resizeObserver.disconnect();
    };
  }, [children]);

  useEffect(() => {
    if (!thumbDragging) return;

    const viewport = viewportRef.current;
    if (!viewport) return;

    const handlePointerMove = (event: PointerEvent): void => {
      viewport.scrollLeft = getScrollLeftForThumbDrag({
        clientWidth: viewport.clientWidth,
        scrollWidth: viewport.scrollWidth,
        thumbWidth: metrics.thumbWidth,
        startScrollLeft: dragStartScrollLeftRef.current,
        deltaX: event.clientX - dragStartXRef.current,
      });
    };

    const handlePointerUp = (): void => {
      setThumbDragging(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [metrics.thumbWidth, thumbDragging]);

  return (
    <div className={cn("overlay-x-scroll relative", className)}>
      <div
        ref={viewportRef}
        className={cn(
          "overlay-x-scroll-viewport scrollbar-hidden",
          viewportClassName,
        )}
        style={
          noDrag
            ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties)
            : undefined
        }
      >
        {children}
      </div>
      {metrics.visible && (
        <div className="pointer-events-none absolute inset-x-1 bottom-0.5 h-1.5 rounded-full bg-transparent">
          <div
            className={cn(
              "pointer-events-auto absolute top-0 h-1.5 rounded-full transition-colors",
              thumbDragging
                ? "cursor-grabbing bg-muted-foreground/90"
                : thumbHovered
                  ? "cursor-grab bg-muted-foreground/75"
                  : "cursor-grab bg-border/90",
            )}
            style={{
              width: `${metrics.thumbWidth}px`,
              transform: `translateX(${metrics.thumbOffset}px)`,
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const viewport = viewportRef.current;
              if (!viewport) return;
              dragStartXRef.current = event.clientX;
              dragStartScrollLeftRef.current = viewport.scrollLeft;
              setThumbDragging(true);
            }}
            onPointerEnter={() => setThumbHovered(true)}
            onPointerLeave={() => setThumbHovered(false)}
          />
        </div>
      )}
    </div>
  );
}

export function TerminalDock(): ReactElement | null {
  const dock = useUIStore((s) => s.terminalDock);
  const closeTerminalDock = useUIStore((s) => s.closeTerminalDock);
  const minimizeTerminalDock = useUIStore((s) => s.minimizeTerminalDock);
  const restoreTerminalDock = useUIStore((s) => s.restoreTerminalDock);
  const setTerminalDockLayout = useUIStore((s) => s.setTerminalDockLayout);
  const refreshKeys = useUIStore((s) => s.terminalRefreshKey);
  const bumpTerminalRefreshKey = useUIStore((s) => s.bumpTerminalRefreshKey);
  const characters = useCharacterStore((s) => s.characters);
  const loadCharacters = useCharacterStore((s) => s.loadFromMain);

  const charactersById = useMemo(
    () => new Map(characters.map((character) => [character.id, character])),
    [characters],
  );
  const renderMode = getTerminalDockRenderMode({
    visible: dock.visible,
    minimized: dock.minimized,
  });
  const [dropTarget, setDropTarget] = useState<SurfaceDropTarget>(null);
  const [draggedSurface, setDraggedSurface] =
    useState<SurfaceDragPayload | null>(null);
  const [barHeight, setBarHeight] = useState(() =>
    resolveTerminalDockBarHeight(
      typeof window === "undefined"
        ? null
        : window.localStorage.getItem(TERMINAL_DOCK_BAR_HEIGHT_STORAGE_KEY),
    ),
  );
  const barSideSlotWidth = useMemo(
    () => getTerminalDockBarSideSlotWidth(barHeight),
    [barHeight],
  );
  const footerResizeRef = useRef<{ startY: number; startHeight: number } | null>(
    null,
  );
  const minimizedResizeRef = useRef<{
    startScreenY: number;
    startHeight: number;
    lastHeight: number;
  } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      TERMINAL_DOCK_BAR_HEIGHT_STORAGE_KEY,
      String(barHeight),
    );
    void window.api.invoke(IPC_COMMANDS.TERMINAL_DOCK_SET_MINIMIZED_HEIGHT, {
      height: barHeight,
    });
  }, [barHeight]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent): void => {
      const footerResizeState = footerResizeRef.current;
      if (footerResizeState) {
        setBarHeight(
          getResizedTerminalDockBarHeight(
            footerResizeState.startHeight,
            event.clientY - footerResizeState.startY,
          ),
        );
      }

      const minimizedResizeState = minimizedResizeRef.current;
      if (minimizedResizeState) {
        const nextHeight = getResizedTerminalDockBarHeight(
          minimizedResizeState.startHeight,
          event.screenY - minimizedResizeState.startScreenY,
        );
        if (nextHeight !== minimizedResizeState.lastHeight) {
          minimizedResizeState.lastHeight = nextHeight;
          setBarHeight(nextHeight);
        }
      }
    };

    const handlePointerUp = (): void => {
      footerResizeRef.current = null;
      minimizedResizeRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  useEffect(() => {
    if (renderMode === "hidden") return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        minimizeTerminalDock(barHeight);
        return;
      }

      if (event.metaKey && !event.shiftKey && event.key === "\\") {
        event.preventDefault();
        setTerminalDockLayout(
          splitDockPane(dock.layout, dock.focusedPaneId, "horizontal"),
        );
        return;
      }

      if (event.metaKey && event.shiftKey && event.key === "|") {
        event.preventDefault();
        setTerminalDockLayout(
          splitDockPane(dock.layout, dock.focusedPaneId, "vertical"),
        );
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    dock.focusedPaneId,
    dock.layout,
    barHeight,
    minimizeTerminalDock,
    renderMode,
    setTerminalDockLayout,
  ]);

  useEffect(() => {
    if (renderMode !== "dock") return;

    if (dock.activeCharacterId) {
      void window.api.invoke(IPC_COMMANDS.CHARACTER_RUNTIME_SET_ATTENTION, {
        characterId: dock.activeCharacterId,
        attentionActive: true,
      });
    }

    return () => {
      if (dock.activeCharacterId) {
        void window.api.invoke(IPC_COMMANDS.CHARACTER_RUNTIME_SET_ATTENTION, {
          characterId: dock.activeCharacterId,
          attentionActive: false,
        });
      }
    };
  }, [dock.activeCharacterId, renderMode]);

  const handleCreateCharacter = useCallback(
    async (paneId: string) => {
      try {
        const existingNames = new Set(
          characters.map((character) => character.name),
        );
        let index = 1;
        let name = "";
        while (true) {
          name = `new_${String(index).padStart(2, "0")}`;
          if (!existingNames.has(name)) break;
          index += 1;
        }

        const assets = await window.api.invoke<AssetListEntry[]>(
          IPC_COMMANDS.ASSET_LIST,
        );
        const skins = (assets ?? []).filter(
          (asset) => asset.category === "skin",
        );
        const randomSkin =
          skins.length > 0
            ? skins[Math.floor(Math.random() * skins.length)]
            : null;

        await window.api.invoke(IPC_COMMANDS.CHARACTER_CREATE, {
          name,
          ...(randomSkin ? { skin: randomSkin.relativePath } : {}),
        });
        await loadCharacters();

        const newCharacter = useCharacterStore
          .getState()
          .characters.find((character) => character.name === name);
        if (newCharacter) {
          const next = cloneLayoutWithFocusedPane(dock.layout, paneId);
          setTerminalDockLayout(ensureCharacterSurface(next, newCharacter.id));
        }
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to create character.",
        );
      }
    },
    [characters, dock.layout, loadCharacters, setTerminalDockLayout],
  );

  const handleGlobalCharacterClick = useCallback(
    (characterId: string) => {
      setTerminalDockLayout(ensureCharacterSurface(dock.layout, characterId));
    },
    [dock.layout, setTerminalDockLayout],
  );

  const handleGlobalCharacterSessionAction = useCallback(
    async (characterId: string, action: GlobalCharacterSessionAction) => {
      try {
        const character = useCharacterStore
          .getState()
          .characters.find((entry) => entry.id === characterId);
        if (!character) return;

        if (action === "unassign") {
          if (!character.currentSessionId) return;
          await window.api.invoke(IPC_COMMANDS.SESSION_STOP, { characterId });
          await loadCharacters();
          return;
        }

        if (action === "reassign" && character.currentSessionId) {
          await window.api.invoke(IPC_COMMANDS.SESSION_STOP, { characterId });
          await loadCharacters();
        }

        const nextLayout = getLayoutForGlobalCharacterSessionAction(
          useUIStore.getState().terminalDock.layout,
          characterId,
          action,
        );
        setTerminalDockLayout(nextLayout);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to update session.",
        );
      }
    },
    [loadCharacters, setTerminalDockLayout],
  );

  const handleMinimizedCharacterClick = useCallback(
    (characterId: string) => {
      restoreTerminalDock();
      setTerminalDockLayout(ensureCharacterSurface(dock.layout, characterId));
    },
    [dock.layout, restoreTerminalDock, setTerminalDockLayout],
  );

  const handleTerminalSessionRefresh = useCallback(
    async (characterId: string) => {
      try {
        const character = useCharacterStore
          .getState()
          .characters.find((entry) => entry.id === characterId);
        if (!character?.currentSessionId) return;
        const { sessions } = await window.api.invoke<AgitoPersistentData>(
          IPC_COMMANDS.STORE_READ,
        );

        await window.api.invoke(
          IPC_COMMANDS.SESSION_RESUME,
          buildSessionResumeInvokeArgs({
            characterId,
            sessionId: character.currentSessionId,
            sessions,
          }),
        );
        await loadCharacters();
        bumpTerminalRefreshKey(characterId);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to refresh session.",
        );
      }
    },
    [bumpTerminalRefreshKey, loadCharacters],
  );

  const minimizedCharacters = useMemo(() => {
    return getMinimizedCharacters(characters, dock.layout);
  }, [characters, dock.layout]);

  if (renderMode === "hidden") return null;

  if (renderMode === "minimized-bar") {
    return (
      <div
        className="relative flex h-full w-full items-stretch overflow-hidden bg-background/95 px-2 py-1 select-none"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div
          className="group absolute inset-x-0 top-0 z-20 h-2 cursor-row-resize"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            minimizedResizeRef.current = {
              startScreenY: event.screenY,
              startHeight: barHeight,
              lastHeight: barHeight,
            };
          }}
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-transparent transition-colors group-hover:bg-border/70" />
        </div>
        <div
          className="relative shrink-0"
          style={{ width: `${barSideSlotWidth}px` }}
        >
          <button
            className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md p-1 text-xs text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            onClick={closeTerminalDock}
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <OverlayScrollStrip
          className="h-full min-w-0 flex-1"
          viewportClassName="flex h-full items-stretch justify-center gap-1.5"
          noDrag
        >
          {minimizedCharacters.map((character) => (
            <MinimizedSurfaceItem
              key={character.id}
              character={character}
              onClick={() => handleMinimizedCharacterClick(character.id)}
            />
          ))}
        </OverlayScrollStrip>
        <div
          className="group relative shrink-0"
          style={{ width: `${barSideSlotWidth}px` }}
        >
          <MinimizedDragGrip />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      <div
        className="flex h-8 items-center gap-2 border-b border-border bg-muted/30 px-2 select-none"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="shrink-0 px-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/80">
          Agito
        </div>
        <div className="min-w-6 flex-1" />
        <div
          className="flex shrink-0 items-center gap-1"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <SplitActionButton
            label="Split Right"
            shortcut={["⌘", "\\"]}
            onClick={() =>
              setTerminalDockLayout(
                splitDockPane(dock.layout, dock.focusedPaneId, "horizontal"),
              )
            }
          >
            <SquareSplitHorizontal className="h-4 w-4" />
          </SplitActionButton>
          <SplitActionButton
            label="Split Down"
            shortcut={["⌘", "⇧", "\\"]}
            onClick={() =>
              setTerminalDockLayout(
                splitDockPane(dock.layout, dock.focusedPaneId, "vertical"),
              )
            }
          >
            <SquareSplitVertical className="h-4 w-4" />
          </SplitActionButton>
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => minimizeTerminalDock(barHeight)}
            title="Minimize"
          >
            <Minus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <DockNodeView
          node={dock.layout.root}
          layout={dock.layout}
          characters={characters}
          charactersById={charactersById}
          refreshKeys={refreshKeys}
          dropTarget={dropTarget}
          draggedSurface={draggedSurface}
          setDropTarget={setDropTarget}
          setDraggedSurface={setDraggedSurface}
          setLayout={setTerminalDockLayout}
          onCreateCharacter={handleCreateCharacter}
          bumpTerminalRefreshKey={bumpTerminalRefreshKey}
          onRefreshSession={handleTerminalSessionRefresh}
        />
      </div>

      <div
        className="relative box-border bg-background/95 px-2 py-1"
        style={{ height: `${barHeight}px` }}
      >
        <div
          className="group absolute inset-x-0 -top-1 z-20 h-2 cursor-row-resize"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            footerResizeRef.current = {
              startY: event.clientY,
              startHeight: barHeight,
            };
          }}
        >
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-transparent transition-colors group-hover:bg-border/70" />
        </div>
        <div className="flex h-full items-stretch">
          <div
            className="shrink-0"
            style={{ width: `${barSideSlotWidth}px` }}
          />
          <OverlayScrollStrip
            className="h-full min-w-0 flex-1"
            viewportClassName="flex h-full items-stretch justify-center gap-1.5"
            noDrag
          >
            {characters.map((character) => (
              <GlobalCharacterTab
                key={character.id}
                character={character}
                presence={getCharacterDockPresence(dock.layout, character.id)}
                onClick={() => handleGlobalCharacterClick(character.id)}
                onSessionAction={(action) =>
                  void handleGlobalCharacterSessionAction(character.id, action)
                }
              />
            ))}
          </OverlayScrollStrip>
          <div
            className="shrink-0"
            style={{ width: `${barSideSlotWidth}px` }}
          />
        </div>
      </div>
    </div>
  );
}

function DockNodeView({
  node,
  layout,
  characters,
  charactersById,
  refreshKeys,
  dropTarget,
  draggedSurface,
  setDropTarget,
  setDraggedSurface,
  setLayout,
  onCreateCharacter,
  bumpTerminalRefreshKey,
  onRefreshSession,
}: {
  node: DockLayoutNode;
  layout: DockLayout;
  characters: Character[];
  charactersById: Map<string, Character>;
  refreshKeys: Record<string, number>;
  dropTarget: SurfaceDropTarget;
  draggedSurface: SurfaceDragPayload | null;
  setDropTarget: (target: SurfaceDropTarget) => void;
  setDraggedSurface: (payload: SurfaceDragPayload | null) => void;
  setLayout: (layout: DockLayout) => void;
  onCreateCharacter: (paneId: string) => Promise<void>;
  bumpTerminalRefreshKey: (characterId: string) => void;
  onRefreshSession: (characterId: string) => Promise<void>;
}): ReactElement {
  if (node.type === "split") {
    return (
      <PanelGroup
        autoSaveId={node.id}
        className="h-full w-full"
        direction={node.direction}
        onLayout={(sizes) => {
          if (sizes.length === 2) {
            setLayout(
              updateDockSplitSizes(layout, node.id, [
                sizes[0] ?? 50,
                sizes[1] ?? 50,
              ]),
            );
          }
        }}
      >
        {node.children.map((child, index) => (
          <Fragment key={`${node.id}-${index}`}>
            <Panel defaultSize={node.sizes[index]} minSize={18}>
              <DockNodeView
                node={child}
                layout={layout}
                characters={characters}
                charactersById={charactersById}
                refreshKeys={refreshKeys}
                dropTarget={dropTarget}
                draggedSurface={draggedSurface}
                setDropTarget={setDropTarget}
                setDraggedSurface={setDraggedSurface}
                setLayout={setLayout}
                onCreateCharacter={onCreateCharacter}
                bumpTerminalRefreshKey={bumpTerminalRefreshKey}
                onRefreshSession={onRefreshSession}
              />
            </Panel>
            {index < node.children.length - 1 ? (
              <DockResizeHandle direction={node.direction} />
            ) : null}
          </Fragment>
        ))}
      </PanelGroup>
    );
  }

  return (
    <DockPaneView
      pane={node}
      layout={layout}
      characters={characters}
      charactersById={charactersById}
      refreshKeys={refreshKeys}
      dropTarget={dropTarget}
      draggedSurface={draggedSurface}
      setDropTarget={setDropTarget}
      setDraggedSurface={setDraggedSurface}
      setLayout={setLayout}
      onCreateCharacter={onCreateCharacter}
      bumpTerminalRefreshKey={bumpTerminalRefreshKey}
      onRefreshSession={onRefreshSession}
    />
  );
}

function DockResizeHandle({
  direction,
}: {
  direction: "horizontal" | "vertical";
}): ReactElement {
  const isHorizontal = direction === "horizontal";

  return (
    <PanelResizeHandle
      className={cn(
        "relative shrink-0 bg-transparent outline-none before:absolute before:content-[''] before:transition-colors",
        isHorizontal
          ? "-mx-1 w-2 cursor-col-resize before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2"
          : "-my-1 h-2 cursor-row-resize before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2",
        "z-10 before:bg-transparent hover:before:bg-border/70 data-[resize-handle-state=drag]:before:bg-foreground/25",
      )}
    />
  );
}

function DockPaneView({
  pane,
  layout,
  characters,
  charactersById,
  refreshKeys,
  dropTarget,
  draggedSurface,
  setDropTarget,
  setDraggedSurface,
  setLayout,
  onCreateCharacter,
  bumpTerminalRefreshKey,
  onRefreshSession,
}: {
  pane: DockPaneNode;
  layout: DockLayout;
  characters: Character[];
  charactersById: Map<string, Character>;
  refreshKeys: Record<string, number>;
  dropTarget: SurfaceDropTarget;
  draggedSurface: SurfaceDragPayload | null;
  setDropTarget: (target: SurfaceDropTarget) => void;
  setDraggedSurface: (payload: SurfaceDragPayload | null) => void;
  setLayout: (layout: DockLayout) => void;
  onCreateCharacter: (paneId: string) => Promise<void>;
  bumpTerminalRefreshKey: (characterId: string) => void;
  onRefreshSession: (characterId: string) => Promise<void>;
}): ReactElement {
  const isFocused = layout.focusedPaneId === pane.id;
  const [paneHasTerminalFocus, setPaneHasTerminalFocus] = useState(false);
  const availableCharacters = useMemo(
    () => getClosedCharacters(characters, layout),
    [characters, layout],
  );
  const activeSurface = pane.activeSurfaceId
    ? (pane.surfaces.find((surface) => surface.id === pane.activeSurfaceId) ??
      null)
    : null;
  const activeCharacter = activeSurface
    ? (charactersById.get(activeSurface.characterId) ?? null)
    : null;
  const shouldRenderTerminal = shouldRenderAssignedTerminal({
    activeCharacterId: activeSurface?.characterId ?? null,
    hasAssignedSession: Boolean(activeCharacter?.currentSessionId),
  });

  const focusPane = useCallback(() => {
    setLayout(cloneLayoutWithFocusedPane(layout, pane.id));
  }, [layout, pane.id, setLayout]);

  const handleSurfaceDrop = useCallback(
    (event: React.DragEvent, targetIndex: number) => {
      event.preventDefault();
      event.stopPropagation();
      const payload = draggedSurface ?? parseSurfaceDrag(event);
      setDropTarget(null);
      setDraggedSurface(null);
      if (!payload) return;

      if (payload.sourcePaneId === pane.id) {
        setLayout(
          reorderPaneSurface(layout, pane.id, payload.surfaceId, targetIndex),
        );
        return;
      }

      setLayout(
        moveSurfaceToPane(layout, payload.surfaceId, pane.id, targetIndex),
      );
    },
    [draggedSurface, layout, pane.id, setDropTarget, setDraggedSurface, setLayout],
  );

  const setPaneDropTarget = useCallback(
    (event: React.DragEvent) => {
      const payload = draggedSurface;
      if (!payload) return;
      event.preventDefault();
      setDropTarget({
        paneId: pane.id,
        index: pane.surfaces.length,
        mode: "pane",
      });
    },
    [draggedSurface, pane.id, pane.surfaces.length, setDropTarget],
  );

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col border-b border-r border-border bg-background transition-colors",
        dropTarget?.paneId === pane.id &&
          dropTarget.mode === "pane" &&
          "bg-muted/15",
      )}
      onMouseDown={focusPane}
      onDragOver={setPaneDropTarget}
      onDrop={(event) => handleSurfaceDrop(event, pane.surfaces.length)}
    >
      <div
        className={cn(
          "flex items-stretch border-b border-border pr-1 transition-colors",
          isFocused ? "bg-muted/70" : "bg-muted/20",
        )}
        onDragOver={setPaneDropTarget}
        onDrop={(event) => handleSurfaceDrop(event, pane.surfaces.length)}
      >
        <OverlayScrollStrip
          className="h-7 flex-1"
          viewportClassName="flex h-full items-stretch"
        >
          {pane.surfaces.map((surface, index) => (
            <SurfaceTab
              key={surface.id}
              paneId={pane.id}
              surface={surface}
              isActive={surface.id === pane.activeSurfaceId}
              character={charactersById.get(surface.characterId) ?? null}
              showLeadingDrop={
                dropTarget?.paneId === pane.id &&
                dropTarget.mode === "insert" &&
                dropTarget.index === index
              }
              onSelect={() =>
                setLayout(activatePaneSurface(layout, pane.id, surface.id))
              }
              onClose={() =>
                setLayout(closeDockSurface(layout, pane.id, surface.id))
              }
              onRefresh={() => {
                if (surface.characterId) {
                  bumpTerminalRefreshKey(surface.characterId);
                }
              }}
              onDragStart={(payload) => setDraggedSurface(payload)}
              onDragEnd={() => {
                setDropTarget(null);
                setDraggedSurface(null);
              }}
              onDragOver={(event) => {
                event.stopPropagation();
                const payload = draggedSurface;
                if (!payload) return;
                const rect = event.currentTarget.getBoundingClientRect();
                const nextIndex = getSurfaceDropInsertIndex({
                  layout,
                  draggedSurfaceId: payload.surfaceId,
                  targetPaneId: pane.id,
                  targetIndex: index,
                  clientX: event.clientX,
                  left: rect.left,
                  width: rect.width,
                });
                event.preventDefault();
                setDropTarget({
                  paneId: pane.id,
                  index: nextIndex,
                  mode: "insert",
                });
              }}
              onDrop={(event) => {
                const payload = draggedSurface ?? parseSurfaceDrag(event);
                if (!payload) return;
                const rect = event.currentTarget.getBoundingClientRect();
                const dropTargetIndex = getSurfaceDropInsertIndex({
                  layout,
                  draggedSurfaceId: payload.surfaceId,
                  targetPaneId: pane.id,
                  targetIndex: index,
                  clientX: event.clientX,
                  left: rect.left,
                  width: rect.width,
                });
                handleSurfaceDrop(
                  event,
                  getSurfaceReorderIndexFromDropTarget({
                    layout,
                    draggedSurfaceId: payload.surfaceId,
                    targetPaneId: pane.id,
                    dropTargetIndex,
                  }),
                );
              }}
            />
          ))}
          {dropTarget?.paneId === pane.id &&
            dropTarget.mode === "insert" &&
            dropTarget.index === pane.surfaces.length && (
              <div className="h-full w-0.5 shrink-0 self-stretch bg-foreground/60" />
            )}
        </OverlayScrollStrip>
        <div className="flex shrink-0 items-center gap-0.5 pl-1">
          <SurfaceMenuTrigger
            paneId={pane.id}
            availableCharacters={availableCharacters}
            onSelectCharacter={(characterId) => {
              const next = cloneLayoutWithFocusedPane(layout, pane.id);
              setLayout(ensureCharacterSurface(next, characterId));
            }}
            onCreateCharacter={onCreateCharacter}
            iconToneClassName={
              isFocused ? "text-muted-foreground" : "text-muted-foreground/70"
            }
          />
          <button
            className={cn(
              "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-muted/55 hover:text-foreground",
              isFocused ? "text-muted-foreground" : "text-muted-foreground/70",
            )}
            onClick={() => setLayout(removeDockPane(layout, pane.id))}
            title="Close pane"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        onDragOver={setPaneDropTarget}
        onDrop={(event) => handleSurfaceDrop(event, pane.surfaces.length)}
        onFocusCapture={() => {
          if (shouldRenderTerminal) {
            setPaneHasTerminalFocus(true);
          }
        }}
        onBlurCapture={(event) => {
          requestAnimationFrame(() => {
            const nextFocused = event.currentTarget.contains(
              document.activeElement,
            );
            if (!nextFocused) {
              setPaneHasTerminalFocus(false);
            }
          });
        }}
      >
        {activeCharacter && shouldRenderTerminal && paneHasTerminalFocus && (
          <div className="pointer-events-none absolute right-2 top-2 z-20">
            <button
              className="pointer-events-auto flex h-[18px] w-[18px] items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void onRefreshSession(activeCharacter.id)}
              title="Refresh terminal"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
        )}
        {activeCharacter && shouldRenderTerminal && (
          <TerminalView
            key={`${activeCharacter.id}-${refreshKeys[activeCharacter.id] ?? 0}`}
            characterId={activeCharacter.id}
            engine={activeCharacter.engine ?? "claude-code"}
          />
        )}

        {activeCharacter && !shouldRenderTerminal && (
          <SessionAssignView
            character={activeCharacter}
            onSessionStarted={() => {}}
          />
        )}

        {!activeCharacter && <div className="h-full w-full bg-background" />}
      </div>
    </div>
  );
}

function SurfaceTab({
  paneId,
  surface,
  isActive,
  character,
  showLeadingDrop,
  onSelect,
  onClose,
  onRefresh,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  paneId: string;
  surface: DockSurface;
  isActive: boolean;
  character: Character | null;
  showLeadingDrop: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRefresh: () => void;
  onDragStart: (payload: SurfaceDragPayload) => void;
  onDragEnd: () => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
}): ReactElement {
  const runtimeState = useRuntimeStore((s) => s.states[surface.characterId]);
  const [skinPreview, setSkinPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!character?.skin) return;
    const relPath = character.skin.startsWith("assets/")
      ? character.skin.slice(7)
      : character.skin;
    window.api
      .invoke<string | null>(IPC_COMMANDS.ASSET_READ_BASE64, relPath)
      .then(setSkinPreview);
  }, [character?.skin]);

  const status = getCharacterMarkerStatus(
    runtimeState,
    character?.currentSessionId ?? null,
  );

  return (
    <div
      className="relative flex shrink-0 items-stretch"
      draggable
      onDragStart={(event) => {
        const payload = {
          sourcePaneId: paneId,
          surfaceId: surface.id,
        } satisfies SurfaceDragPayload;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(
          "application/x-agito-surface",
          JSON.stringify(payload),
        );
        onDragStart(payload);
      }}
      onDragEnd={() => {
        onDragEnd();
        onRefresh();
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {showLeadingDrop && (
        <div className="absolute left-0 top-0 bottom-0 z-10 w-0.5 bg-foreground/60" />
      )}
      <button
        className={cn(
          "group flex h-7 items-center gap-1.5 border-r border-border px-2 text-[11px] leading-none transition-colors",
          isActive
            ? "bg-background text-foreground"
            : "bg-transparent text-muted-foreground hover:bg-muted/35 hover:text-foreground",
        )}
        onClick={onSelect}
        title={character?.name ?? surface.characterId}
      >
        {skinPreview ? (
          <img
            src={skinPreview}
            alt=""
            className="h-4 w-4 shrink-0 object-contain"
            style={{ imageRendering: "pixelated" }}
          />
        ) : (
          <span className="flex h-4 w-4 items-center justify-center rounded bg-muted text-[9px]">
            {(character?.name ?? surface.characterId)[0]}
          </span>
        )}
        <span className="max-w-[120px] truncate">
          {character?.name ?? surface.characterId}
        </span>
        <span className="ml-0.5 flex h-2.5 w-2.5 shrink-0 items-center justify-center self-center">
          <CharacterStatusBadge
            status={status}
            className="h-2.5 w-2.5 shrink-0"
          />
        </span>
        <span
          className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-[opacity,background-color,color] group-hover:opacity-100 hover:bg-muted/60 hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <X className="h-3 w-3" />
        </span>
      </button>
    </div>
  );
}

function MinimizedSurfaceItem({
  character,
  onClick,
}: {
  character: Character;
  onClick: () => void;
}): ReactElement {
  const runtimeState = useRuntimeStore((s) => s.states[character.id]);
  const [skinPreview, setSkinPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!character.skin) return;
    const relPath = character.skin.startsWith("assets/")
      ? character.skin.slice(7)
      : character.skin;
    window.api
      .invoke<string | null>(IPC_COMMANDS.ASSET_READ_BASE64, relPath)
      .then(setSkinPreview);
  }, [character.skin]);

  const status = getCharacterMarkerStatus(
    runtimeState,
    character.currentSessionId,
  );

  return (
    <div className="relative h-full shrink-0">
      <button
        className="relative flex h-full aspect-square items-center justify-center rounded-md p-1 transition-colors hover:bg-muted/50"
        onClick={onClick}
        title={character.name}
      >
        {skinPreview ? (
          <img
            src={skinPreview}
            alt=""
            className="h-full w-full object-contain"
            style={{ imageRendering: "pixelated" }}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center rounded bg-muted text-[10px]">
            {character.name[0]}
          </span>
        )}
        <CharacterStatusBadge
          status={status}
          className="absolute left-0.5 top-0.5 h-2.5 w-2.5"
        />
      </button>
    </div>
  );
}

function CharacterMenuItem({
  character,
  onClick,
}: {
  character: Character;
  onClick: () => void;
}): ReactElement {
  const [skinPreview, setSkinPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!character.skin) return;
    const relPath = character.skin.startsWith("assets/")
      ? character.skin.slice(7)
      : character.skin;
    window.api
      .invoke<string | null>(IPC_COMMANDS.ASSET_READ_BASE64, relPath)
      .then(setSkinPreview);
  }, [character.skin]);

  return (
    <DropdownMenuItem className="gap-2" onClick={onClick}>
      {skinPreview ? (
        <img
          src={skinPreview}
          alt=""
          className="h-5 w-5 shrink-0 rounded-sm object-contain"
          style={{ imageRendering: "pixelated" }}
        />
      ) : (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px]">
          {character.name[0]}
        </span>
      )}
      <span className="truncate">{character.name}</span>
    </DropdownMenuItem>
  );
}

function SurfaceMenuTrigger({
  paneId,
  availableCharacters,
  onSelectCharacter,
  onCreateCharacter,
  buttonLabel,
  buttonClassName,
  iconToneClassName,
}: {
  paneId: string;
  availableCharacters: Character[];
  onSelectCharacter: (characterId: string) => void;
  onCreateCharacter: (paneId: string) => Promise<void>;
  buttonLabel?: string;
  buttonClassName?: string;
  iconToneClassName?: string;
}): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            buttonLabel
              ? "flex h-8 w-auto shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              : "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-muted/55 hover:text-foreground",
            !buttonLabel && iconToneClassName,
            buttonClassName,
          )}
          title={buttonLabel ?? "Add tab"}
        >
          <Plus className={buttonLabel ? "h-4 w-4" : "h-3 w-3"} />
          {buttonLabel ? <span className="ml-1">{buttonLabel}</span> : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[240px]">
        <DropdownMenuLabel>New tab with...</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-[280px] overflow-y-auto styled-scroll">
          {availableCharacters.length > 0 ? (
            availableCharacters.map((character) => (
              <CharacterMenuItem
                key={character.id}
                character={character}
                onClick={() => onSelectCharacter(character.id)}
              />
            ))
          ) : (
            <DropdownMenuItem disabled>
              No available characters
            </DropdownMenuItem>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void onCreateCharacter(paneId)}>
          + New Character
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function GlobalCharacterTab({
  character,
  presence,
  onClick,
  onSessionAction,
}: {
  character: Character;
  presence: ReturnType<typeof getCharacterDockPresence>;
  onClick: () => void;
  onSessionAction: (action: GlobalCharacterSessionAction) => void;
}): ReactElement {
  const runtimeState = useRuntimeStore((s) => s.states[character.id]);
  const [skinPreview, setSkinPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!character.skin) return;
    const relPath = character.skin.startsWith("assets/")
      ? character.skin.slice(7)
      : character.skin;
    window.api
      .invoke<string | null>(IPC_COMMANDS.ASSET_READ_BASE64, relPath)
      .then(setSkinPreview);
  }, [character.skin]);

  const status = getCharacterMarkerStatus(
    runtimeState,
    character.currentSessionId,
  );

  return (
    <DropdownMenu>
      <div className="group relative h-full shrink-0">
        <button
          className={cn(
            "relative flex h-full aspect-square shrink-0 items-center justify-center rounded-md p-1 transition-colors",
            presence === "focused-active"
              ? "bg-background shadow-[inset_0_0_0_1px_hsl(var(--border))]"
              : presence === "open"
                ? "bg-muted/60 hover:bg-muted"
                : "hover:bg-muted/50",
          )}
          onClick={onClick}
          title={character.name}
        >
          {skinPreview ? (
            <img
              src={skinPreview}
              alt=""
              className="h-full w-full object-contain"
              style={{ imageRendering: "pixelated" }}
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center rounded bg-muted text-[10px]">
              {character.name[0]}
            </span>
          )}
          <CharacterStatusBadge
            status={status}
            className={cn(
              "absolute left-0.5 top-0.5 h-2.5 w-2.5",
              presence === "closed" && "opacity-60",
            )}
          />
        </button>

        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "absolute right-0.5 top-0.5 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-sm bg-background/90 text-muted-foreground shadow-sm backdrop-blur-sm transition-opacity hover:bg-background hover:text-foreground",
              presence === "focused-active"
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100",
            )}
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            title={`${character.name} menu`}
          >
            <MoreHorizontal className="h-2.5 w-2.5" />
          </button>
        </DropdownMenuTrigger>
      </div>

      <DropdownMenuContent align="end" sideOffset={6} className="w-[180px]">
        {character.currentSessionId === null ? (
          <DropdownMenuItem onClick={() => onSessionAction("assign")}>
            Assign Session
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onClick={() => onSessionAction("reassign")}>
              Reassign Session
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onSessionAction("unassign")}>
              Unassign Session
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MinimizedDragGrip(): ReactElement {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="grid grid-cols-2 gap-x-1 gap-y-0.5 transition-opacity group-hover:opacity-100">
        {Array.from({ length: 6 }).map((_, index) => (
          <span
            key={index}
            className="h-0.5 w-0.5 rounded-full bg-muted-foreground"
          />
        ))}
      </div>
    </div>
  );
}

function SplitActionButton({
  children,
  label,
  shortcut,
  onClick,
}: {
  children: ReactElement;
  label: string;
  shortcut: string[];
  onClick: () => void;
}): ReactElement {
  return (
    <div className="group relative">
      <button
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        onClick={onClick}
        title={label}
      >
        {children}
      </button>
      <div className="pointer-events-none absolute right-0 top-[calc(100%+6px)] z-20 inline-flex items-center gap-2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <span>{label}</span>
        <span className="inline-flex items-center gap-1">
          {shortcut.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </span>
      </div>
    </div>
  );
}

interface EngineDetectResult {
  found: boolean;
  path?: string;
  version?: string;
}

function SessionAssignView({
  character,
  onSessionStarted,
}: {
  character: Character;
  onSessionStarted: () => void;
}): ReactElement {
  const loadCharacters = useCharacterStore((s) => s.loadFromMain);
  const [scannedSessions, setScannedSessions] = useState<ScannedSession[]>([]);
  const [scanning, setScanning] = useState(false);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [detectedEngines, setDetectedEngines] = useState<EngineType[]>([]);
  const [selectedEngine, setSelectedEngine] = useState<EngineType | null>(null);

  useEffect(() => {
    const engineKeys: EngineType[] = ["claude-code", "codex"];
    Promise.all(
      engineKeys.map(async (key) => {
        try {
          const result = await window.api.invoke<EngineDetectResult>(
            IPC_COMMANDS.ENGINE_DETECT_CLI,
            key,
          );
          return result?.found ? key : null;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      const found = results.filter(
        (result): result is EngineType => result !== null,
      );
      setDetectedEngines(found);
      if (found.length > 0) {
        setSelectedEngine(found[0]);
      }
    });
  }, []);

  useEffect(() => {
    const engine = selectedEngine ?? character.engine;
    setScanning(true);
    window.api
      .invoke<ScannedSession[]>(IPC_COMMANDS.SESSION_SCAN)
      .then((sessions) => {
        setScannedSessions(
          (sessions ?? []).filter((session) => session.engineType === engine),
        );
        setScanning(false);
      });
  }, [character.engine, selectedEngine]);

  const handleNewSessionInDir = useCallback(
    async (directory: string) => {
      try {
        const engine = selectedEngine ?? character.engine;
        await window.api.invoke(IPC_COMMANDS.SESSION_START, {
          characterId: character.id,
          workingDirectory: directory,
          engine,
        });
        await loadCharacters();
        onSessionStarted();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [
      character.engine,
      character.id,
      loadCharacters,
      onSessionStarted,
      selectedEngine,
    ],
  );

  const handleNewWorkDir = useCallback(async () => {
    const directory = await window.api.invoke<string | null>(
      IPC_COMMANDS.DIALOG_OPEN_FOLDER,
    );
    if (!directory) return;

    try {
      const engine = selectedEngine ?? character.engine;
      await window.api.invoke(IPC_COMMANDS.SESSION_START, {
        characterId: character.id,
        workingDirectory: directory,
        engine,
      });
      await loadCharacters();
      onSessionStarted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [
    character.engine,
    character.id,
    loadCharacters,
    onSessionStarted,
    selectedEngine,
  ]);

  const handleAssignSession = useCallback(
    async (
      sessionId: string,
      workingDirectory: string,
      scannedEngineType: EngineType,
    ) => {
      try {
        await window.api.invoke(IPC_COMMANDS.SESSION_RESUME, {
          characterId: character.id,
          sessionId,
          workingDirectory,
          engineType: resolveSessionResumeEngine({
            scannedEngineType,
            selectedEngine,
            characterEngine: character.engine,
          }),
        });
        await loadCharacters();
        onSessionStarted();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [
      character.engine,
      character.id,
      loadCharacters,
      onSessionStarted,
      selectedEngine,
    ],
  );

  const toggleDir = useCallback((directory: string) => {
    setCollapsedDirs((previous) => {
      const next = new Set(previous);
      if (next.has(directory)) next.delete(directory);
      else next.add(directory);
      return next;
    });
  }, []);

  const sessionsByDir = scannedSessions.reduce<Map<string, ScannedSession[]>>(
    (map, session) => {
      const key = session.workingDirectory || "Unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(session);
      return map;
    },
    new Map(),
  );

  const shortDir = (directory: string): string =>
    directory.replace(/^\/Users\/[^/]+/, "~");

  return (
    <div
      className="scrollbar-hidden flex-1 space-y-3 overflow-y-auto p-4"
      style={{ minHeight: 0 }}
    >
      {detectedEngines.length > 1 && (
        <div className="flex items-center gap-1 border-b border-border pb-2">
          {detectedEngines.map((engine) => (
            <button
              key={engine}
              className={`rounded-t px-2.5 py-1 text-[11px] transition-colors ${
                selectedEngine === engine
                  ? "border border-border border-b-background bg-background text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
              onClick={() => setSelectedEngine(engine)}
            >
              {ENGINE_DISPLAY[engine] ?? engine}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {scanning
            ? "Scanning sessions..."
            : `${scannedSessions.length} sessions found`}
        </p>
        <button
          className="rounded bg-primary px-2.5 py-1 text-[11px] text-primary-foreground transition-colors hover:bg-primary/90"
          onClick={handleNewWorkDir}
        >
          + New Directory
        </button>
      </div>

      {!scanning && scannedSessions.length === 0 && (
        <div className="py-8 text-center">
          <p className="mb-2 text-sm text-muted-foreground">
            No {selectedEngine ?? character.engine} sessions found
          </p>
          <button
            className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90"
            onClick={handleNewWorkDir}
          >
            Start New Session
          </button>
        </div>
      )}

      {[...sessionsByDir.entries()].map(([directory, sessions]) => {
        const isCollapsed = collapsedDirs.has(directory);
        const isShowingMore = expandedDirs.has(directory);
        const visibleSessions = isShowingMore ? sessions : sessions.slice(0, 5);
        const hasMore = sessions.length > 5;

        return (
          <div
            key={directory}
            className="rounded-md border border-border bg-muted/10"
          >
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <button
                className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => toggleDir(directory)}
              >
                <span
                  className={`text-[10px] transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                >
                  &#9654;
                </span>
              </button>
              <span
                className="flex-1 truncate font-mono text-[11px] text-muted-foreground"
                title={directory}
              >
                {shortDir(directory)}
              </span>
              <button
                className="shrink-0 rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => handleNewSessionInDir(directory)}
              >
                New Session
              </button>
            </div>

            {!isCollapsed && (
              <div className="border-t border-border">
                {visibleSessions.map((session) => (
                  <div
                    key={session.sessionId}
                    className="group flex items-center gap-2 py-1.5 pl-7 pr-3 transition-colors hover:bg-muted/30"
                  >
                    <span className="flex-1 truncate font-mono text-[11px] text-foreground">
                      {session.label || session.sessionId.slice(0, 12)}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground/60">
                      {session.lastActiveAt
                        ? new Date(session.lastActiveAt).toLocaleDateString()
                        : ""}
                    </span>
                    <button
                      className="shrink-0 rounded bg-primary/10 px-2 py-0.5 text-[10px] text-primary opacity-0 transition-colors group-hover:opacity-100 hover:bg-primary hover:text-primary-foreground"
                      onClick={() =>
                        handleAssignSession(
                          session.sessionId,
                          directory,
                          session.engineType,
                        )
                      }
                    >
                      Assign
                    </button>
                  </div>
                ))}
                {hasMore && !isShowingMore && (
                  <button
                    className="w-full py-1.5 text-center text-[10px] text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground"
                    onClick={() =>
                      setExpandedDirs((previous) =>
                        new Set(previous).add(directory),
                      )
                    }
                  >
                    ...{sessions.length - 5} more
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
