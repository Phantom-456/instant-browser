/** What the Settings screen shows about Drive sync. */
export interface SyncStatus {
  /** This build has a Google login key, so it can connect. */
  available: boolean
  state: 'off' | 'connecting' | 'needs-passphrase' | 'locked' | 'idle' | 'syncing' | 'offline' | 'error'
  /** A sentence for the Settings screen. */
  message: string
  lastSyncAt: number | null
  /** About the lock on the synced data. Null while nothing is set up. */
  security: SyncSecurity | null
  /** How many items are in the shared file (synced) and how many stay only here. */
  counts: SyncCounts
  /** Your other computers that share what they have open (name and when they last synced). */
  computers: Array<{ name: string; updatedAt: number }>
}

export interface SyncSecurity {
  /** The key is on this computer, so data is locked before it leaves. */
  active: boolean
  cipher: string
  kdf: string
  /** When the key on this computer was set or last changed. */
  keySetAt: number | null
  /** How the passphrase was rated when it was chosen (empty when it was typed on another computer). */
  rating: string
  /** A recovery key was made (a spare way to unlock if the passphrase is lost). */
  recovery: boolean
  /** Where the key lives on this computer. */
  keyStorage: 'keychain' | 'private-file'
}

export interface SyncCounts {
  pins: { synced: number; local: number }
  bookmarks: { synced: number; local: number }
  history: { synced: number; local: number }
}

export const NO_COUNTS: SyncCounts = { pins: { synced: 0, local: 0 }, bookmarks: { synced: 0, local: 0 }, history: { synced: 0, local: 0 } }
