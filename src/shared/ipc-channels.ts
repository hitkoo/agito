// Main -> Renderer events (push)
export const IPC_EVENTS = {
  PTY_DATA: 'pty:data',
  CHARACTER_STATUS: 'character:status',
  STORE_UPDATED: 'store:updated',
  ASSET_GENERATE_PROGRESS: 'asset:generate-progress',
} as const

// Renderer -> Main commands (invoke)
export const IPC_COMMANDS = {
  // PTY management
  PTY_SPAWN: 'pty:spawn',
  PTY_WRITE: 'pty:write',
  PTY_RESIZE: 'pty:resize',
  PTY_KILL: 'pty:kill',
  PTY_IS_ALIVE: 'pty:is-alive',
  PTY_GET_ALIVE_IDS: 'pty:get-alive-ids',
  TERMINAL_GET_SNAPSHOT: 'terminal:get-snapshot',

  // Store operations
  STORE_READ: 'store:read',
  STORE_WRITE: 'store:write',

  // Character operations
  CHARACTER_CREATE: 'character:create',
  CHARACTER_UPDATE: 'character:update',
  CHARACTER_DELETE: 'character:delete',

  // Session operations
  SESSION_START: 'session:start',
  SESSION_RESUME: 'session:resume',
  SESSION_STOP: 'session:stop',
  SESSION_SCAN: 'session:scan',

  // Engine
  ENGINE_DETECT_CLI: 'engine:detect-cli',

  // Dialog
  DIALOG_OPEN_FOLDER: 'dialog:open-folder',

  // Soul management
  SOUL_LIST: 'soul:list',
  SOUL_READ: 'soul:read',
  SOUL_WRITE: 'soul:write',

  // Asset management
  ASSET_RESOLVE_PATH: 'asset:resolve-path',
  ASSET_LIST: 'asset:list',
  ASSET_UPLOAD: 'asset:upload',
  ASSET_READ_BASE64: 'asset:read-base64',

  // Asset generation (via agito-server)
  ASSET_GENERATE: 'asset:generate',

  // Settings
  SETTINGS_READ: 'settings:read',
  SETTINGS_WRITE: 'settings:write',
  // Terminal dock detach/attach
  TERMINAL_DOCK_DETACH: 'terminal-dock:detach',
  TERMINAL_DOCK_ATTACH: 'terminal-dock:attach',
  TERMINAL_DOCK_MINIMIZE: 'terminal-dock:minimize',
  TERMINAL_DOCK_RESTORE: 'terminal-dock:restore',
  TERMINAL_DOCK_GET_STATE: 'terminal-dock:get-state',
  TERMINAL_DOCK_SET_ACTIVE_CHARACTER: 'terminal-dock:set-active-character',
  TERMINAL_DOCK_READY: 'terminal-dock:ready',
} as const

// Terminal dock sync event (Main → Renderer)
export const IPC_DOCK_EVENTS = {
  TERMINAL_DOCK_SYNC: 'terminal-dock:sync',
} as const

export type IPCEvent = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS]
export type IPCCommand = (typeof IPC_COMMANDS)[keyof typeof IPC_COMMANDS]
