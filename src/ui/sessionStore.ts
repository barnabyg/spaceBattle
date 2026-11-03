/** Where settings are kept for the browser session: `sessionStorage`, or a stand-in in tests. */
export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The session's storage, or null where the browser refuses it. */
export const sessionStore = (): SettingsStorage | null => {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
};
