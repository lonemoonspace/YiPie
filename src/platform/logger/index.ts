import type { LogLevel } from '@/contract/general-settings';

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

let threshold: LogLevel = 'info';

/** Applies to every logger in this context (each extension context has its own). */
export function setLogLevel(level: LogLevel): void {
  threshold = level;
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLogger(scope: string): Logger {
  const emit = (level: Exclude<LogLevel, 'silent'>, args: unknown[]) => {
    if (RANK[level] < RANK[threshold]) return;
    console[level](`[yipie:${scope}]`, ...args);
  };

  return {
    debug: (...args) => emit('debug', args),
    info: (...args) => emit('info', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
  };
}
