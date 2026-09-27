/**
 * Development-only logging. Release builds stay silent (no user data in device logs).
 */
export const log = {
  warn: (...args: unknown[]) => {
    if (__DEV__) console.warn(...args);
  },
  error: (...args: unknown[]) => {
    if (__DEV__) console.error(...args);
  },
};
