// Main -> Renderer events (push)
export const IPC_EVENTS = {
  PTY_DATA: 'pty:data',
  CHARACTER_STATUS: 'character:status',
  STORE_UPDATED: 'store:updated',
} as const

// Renderer -> Main commands (invoke)
export const IPC_COMMANDS = {
  // PTY management
  PTY_SPAWN: 'pty:spawn',
  PTY_WRITE: 'pty:write',
  PTY_RESIZE: 'pty:resize',
  PTY_KILL: 'pty:kill',
  PTY_GET_BUFFER: 'pty:get-buffer',

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

  // Engine
  ENGINE_DETECT_CLI: 'engine:detect-cli',

  // Dialog
  DIALOG_OPEN_FOLDER: 'dialog:open-folder',

  // Custom manifest persistence
  MANIFEST_LIST: 'manifest:list',
  MANIFEST_SAVE: 'manifest:save',

  // Soul management
  SOUL_LIST: 'soul:list',
  SOUL_READ: 'soul:read',
  SOUL_WRITE: 'soul:write',

  // Asset / Sprite management
  ASSET_RESOLVE_PATH: 'asset:resolve-path',
  SPRITE_LIST: 'sprite:list',
  SPRITE_UPLOAD: 'sprite:upload',
  SPRITE_READ_BASE64: 'sprite:read-base64',
} as const

export type IPCEvent = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS]
export type IPCCommand = (typeof IPC_COMMANDS)[keyof typeof IPC_COMMANDS]
