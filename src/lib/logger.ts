type LogFn = (...args: unknown[]) => void;

function debugEnabled(): boolean {
  if (process.env.DEBUG_LOGS === '1' || process.env.AIVN_DEBUG_LOGS === '1') return true;
  if (process.env.DEBUG_LOGS === '0' || process.env.AIVN_DEBUG_LOGS === '0') return false;
  return process.env.NODE_ENV !== 'production';
}

export function createLogger(_scope: string): {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
} {
  return {
    debug(...args: unknown[]) {
      if (debugEnabled()) console.log(...args);
    },
    info(...args: unknown[]) {
      if (debugEnabled()) console.log(...args);
    },
    warn(...args: unknown[]) {
      console.warn(...args);
    },
    error(...args: unknown[]) {
      console.error(...args);
    },
  };
}
