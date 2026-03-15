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
  PTY_GET_BUFFER: 'pty:get-buffer',
  PTY_IS_ALIVE: 'pty:is-alive',

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
} as const

export type IPCEvent = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS]
export type IPCCommand = (typeof IPC_COMMANDS)[keyof typeof IPC_COMMANDS]
