import { create } from 'zustand'
import { IPC_COMMANDS } from '../../../shared/ipc-channels'
import type { AuthSessionState } from '../../../shared/auth'

export type AuthDialogMode = 'sign_in' | 'sign_up'

const SIGNED_OUT_STATE: AuthSessionState = {
  status: 'signed_out',
  profile: null,
}

interface AuthStore {
  session: AuthSessionState
  dialogMode: AuthDialogMode | null
  loadFromMain: () => Promise<void>
  setSession: (session: AuthSessionState) => void
  openDialog: (mode: AuthDialogMode) => void
  closeDialog: () => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  session: SIGNED_OUT_STATE,
  dialogMode: null,

  loadFromMain: async () => {
    const session = await window.api.invoke<AuthSessionState>(IPC_COMMANDS.AUTH_GET_SESSION)
    set({ session })
  },

  setSession: (session) => set({ session }),
  openDialog: (mode) => set({ dialogMode: mode }),
  closeDialog: () => set({ dialogMode: null }),
}))
