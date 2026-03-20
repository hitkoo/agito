// Main -> Renderer events (push)
export const IPC_EVENTS = {
  PTY_DATA: 'pty:data',
  CHARACTER_STATUS: 'character:status',
  CHARACTER_RUNTIME: 'character:runtime',
  STORE_UPDATED: 'store:updated',
  ASSET_GENERATE_PROGRESS: 'asset:generate-progress',
  AUTH_SESSION_CHANGED: 'auth:session-changed',
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
  CHARACTER_RUNTIME_SET_ATTENTION: 'character-runtime:set-attention',
  CHARACTER_RUNTIME_SNAPSHOT: 'character-runtime:snapshot',

  // Session operations
  SESSION_START: 'session:start',
  SESSION_SYNC: 'session:sync',
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
  // Auth
  AUTH_GET_SESSION: 'auth:get-session',
  AUTH_SIGN_UP_EMAIL: 'auth:sign-up-email',
  AUTH_SIGN_IN_EMAIL: 'auth:sign-in-email',
  AUTH_SIGN_IN_GOOGLE: 'auth:sign-in-google',
  AUTH_SIGN_OUT: 'auth:sign-out',
  AUTH_RESEND_SIGNUP_VERIFICATION: 'auth:resend-signup-verification',
  AUTH_SEND_PASSWORD_RESET: 'auth:send-password-reset',
  AUTH_REFRESH_SESSION: 'auth:refresh-session',
  // Terminal dock
  TERMINAL_DOCK_SHOW: 'terminal-dock:show',
  TERMINAL_DOCK_HIDE: 'terminal-dock:hide',
  TERMINAL_DOCK_MINIMIZE: 'terminal-dock:minimize',
  TERMINAL_DOCK_RESTORE: 'terminal-dock:restore',
  TERMINAL_DOCK_GET_STATE: 'terminal-dock:get-state',
  TERMINAL_DOCK_SET_LAYOUT: 'terminal-dock:set-layout',
  TERMINAL_DOCK_SET_MINIMIZED_HEIGHT: 'terminal-dock:set-minimized-height',
} as const

// Terminal dock sync event (Main → Renderer)
export const IPC_DOCK_EVENTS = {
  TERMINAL_DOCK_SYNC: 'terminal-dock:sync',
} as const

export type IPCEvent = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS]
export type IPCCommand = (typeof IPC_COMMANDS)[keyof typeof IPC_COMMANDS]
